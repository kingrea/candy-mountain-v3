import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { Readable, Writable } from 'node:stream'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type ContentBlock,
  type CreateElicitationResponse,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
  type SessionUpdate,
  type StopReason,
  type Usage,
} from '@agentclientprotocol/sdk'
import type { AcpEventListener, AcpEventPayload, AcpSessionEvent, AgentFamily, ExitInfo } from './events'
import type { FamilyLaunch } from './families'
import { spawnAgentProcess, type AgentProcess } from './process'

export const AUTH_REQUIRED_CODE = -32000
export const DEFAULT_START_TIMEOUT_MS = 60_000

export type AcpSessionStatus = 'starting' | 'idle' | 'prompting' | 'closed'

export interface PromptResult {
  stopReason: StopReason
  usage: Usage | null
}

export interface AcpSession {
  readonly id: string
  readonly family: AgentFamily
  readonly cwd: string
  readonly configHome: string
  /** The agent's own session id: what loads the conversation again later. */
  readonly upstreamSessionId: string
  readonly pid: number
  readonly status: AcpSessionStatus
  /** What the agent offers to configure (models, reasoning effort, ...), as of its last report. */
  readonly configOptions: readonly SessionConfigOption[]
  readonly exited: Promise<ExitInfo>
  /** Resolves at the end of the turn; rejects when the agent fails it. One turn at a time. */
  prompt(input: string | ContentBlock[]): Promise<PromptResult>
  /** Stops the running turn; the prompt then resolves with stopReason 'cancelled'. */
  cancel(): Promise<void>
  /** Kills the agent process; idempotent. */
  close(): Promise<void>
  subscribe(listener: AcpEventListener): () => void
  /** Events from now until the process exits. */
  events(): AsyncIterableIterator<AcpSessionEvent>
}

export class AcpAuthRequiredError extends Error {
  readonly code = 'auth_required'
  constructor(readonly family: AgentFamily, message: string) {
    super(message)
    this.name = 'AcpAuthRequiredError'
  }
}

export class AcpStartError extends Error {
  readonly code = 'start_failed'
  constructor(readonly family: AgentFamily, message: string) {
    super(message)
    this.name = 'AcpStartError'
  }
}

export interface StartAcpSessionOptions {
  family: AgentFamily
  cwd: string
  configHome: string
  launch: FamilyLaunch
  env: Record<string, string>
  upstreamSessionId?: string
  onEvent?: AcpEventListener
  onStderr?: (text: string) => void
  startTimeoutMs?: number
  killTimeoutMs?: number
}

const isAuthRequired = (error: unknown) => error instanceof RequestError && error.code === AUTH_REQUIRED_CODE
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
const errorCode = (error: unknown) => (error instanceof RequestError ? error.code : null)

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

const UNANSWERABLE_PERMISSION: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } }
const UNANSWERABLE_QUESTION: CreateElicitationResponse = { action: 'cancel' }

interface PendingRequest {
  settle(response: unknown): void
  fallback: unknown
}

class AcpSessionImpl implements AcpSession {
  readonly id = randomUUID()
  readonly family: AgentFamily
  readonly cwd: string
  readonly configHome: string
  upstreamSessionId = ''
  status: AcpSessionStatus = 'starting'
  configOptions: readonly SessionConfigOption[] = []
  readonly exited: Promise<ExitInfo>
  private readonly process: AgentProcess
  private readonly connection: ClientSideConnection
  private readonly listeners = new Set<AcpEventListener>()
  private readonly pending = new Map<string, PendingRequest>()
  private seq = 0
  private closing = false
  private closed: Promise<void> | undefined

  constructor(private readonly options: StartAcpSessionOptions) {
    this.family = options.family
    this.cwd = options.cwd
    this.configHome = options.configHome
    if (options.onEvent) this.listeners.add(options.onEvent)
    this.process = spawnAgentProcess({
      command: options.launch.command,
      args: options.launch.args,
      cwd: options.cwd,
      env: { ...options.env, ...options.launch.env },
      killTimeoutMs: options.killTimeoutMs,
      onStderr: options.onStderr,
    })
    this.exited = this.process.exited
    this.connection = new ClientSideConnection(() => ({
      sessionUpdate: (params) => this.onUpdate(params),
      requestPermission: params => this.ask<RequestPermissionResponse>(UNANSWERABLE_PERMISSION, requestId => ({ kind: 'permission_request', requestId, toolCall: params.toolCall, options: params.options, respond: response => this.answer(requestId, response) })),
      createElicitation: params => this.ask<CreateElicitationResponse>(UNANSWERABLE_QUESTION, requestId => ({ kind: 'question', requestId, request: params, respond: response => this.answer(requestId, response) })),
    }), ndJsonStream(Writable.toWeb(this.process.stdin), Readable.toWeb(this.process.stdout)))
    this.connection.closed.catch((error: unknown) => {
      if (this.status !== 'closed' && !this.closing) this.emit({ kind: 'error', phase: 'connection', message: errorMessage(error), code: errorCode(error) })
    })
    void this.exited.then((exit) => {
      const expected = this.closing
      this.status = 'closed'
      // The connection is gone, so a late answer could not be sent anyway; settling would make the SDK try.
      this.cancelPending(false)
      this.emit({ kind: 'exited', code: exit.code, signal: exit.signal, expected })
      this.listeners.clear()
    })
  }

  get pid(): number {
    return this.process.pid
  }

  async start(): Promise<void> {
    const timeoutMs = this.options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
    const exitedEarly = this.exited.then((exit) => {
      throw this.process.spawnError ?? new Error(`agent exited during startup (code ${exit.code}, signal ${exit.signal})`)
    })
    exitedEarly.catch(() => {})
    try {
      await withTimeout(Promise.race([exitedEarly, this.connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, elicitation: { form: {} } } })]), timeoutMs, 'ACP initialize')
      const { cwd, upstreamSessionId } = this.options
      const roots = this.options.launch.additionalDirectories
      const directories = roots?.length ? { additionalDirectories: [...roots] } : {}
      if (upstreamSessionId) {
        this.upstreamSessionId = upstreamSessionId
        const loaded = await withTimeout(Promise.race([exitedEarly, this.connection.loadSession({ cwd, sessionId: upstreamSessionId, mcpServers: [], ...directories })]), timeoutMs, 'ACP session/load')
        this.configOptions = loaded.configOptions ?? []
      }
      else {
        const created = await withTimeout(Promise.race([exitedEarly, this.connection.newSession({ cwd, mcpServers: [], ...directories })]), timeoutMs, 'ACP session/new')
        this.upstreamSessionId = created.sessionId
        this.configOptions = created.configOptions ?? []
      }
      this.status = 'idle'
    }
    catch (error) {
      await this.close()
      if (isAuthRequired(error)) throw new AcpAuthRequiredError(this.family, errorMessage(error))
      const stderr = this.process.stderrTail.trim()
      throw new AcpStartError(this.family, stderr ? `${errorMessage(error)}: ${stderr}` : errorMessage(error))
    }
  }

  async prompt(input: string | ContentBlock[]): Promise<PromptResult> {
    if (this.status !== 'idle') throw new Error(`Cannot prompt a session that is ${this.status}`)
    const blocks: ContentBlock[] = typeof input === 'string' ? [{ type: 'text', text: input }] : input
    this.status = 'prompting'
    try {
      const response = await this.connection.prompt({ sessionId: this.upstreamSessionId, prompt: blocks })
      const result = { stopReason: response.stopReason, usage: response.usage ?? null }
      this.emit({ kind: 'turn_end', ...result })
      return result
    }
    catch (error) {
      if (isAuthRequired(error)) this.emit({ kind: 'auth_required', message: errorMessage(error) })
      else if (this.status === 'prompting') this.emit({ kind: 'error', phase: 'prompt', message: errorMessage(error), code: errorCode(error) })
      throw error
    }
    finally {
      if (this.status === 'prompting') this.status = 'idle'
      this.cancelPending()
    }
  }

  async cancel(): Promise<void> {
    if (this.status !== 'prompting') return
    try {
      await this.connection.cancel({ sessionId: this.upstreamSessionId })
    }
    catch (error) {
      this.emit({ kind: 'error', phase: 'cancel', message: errorMessage(error), code: errorCode(error) })
    }
    // ACP requires the client to answer every pending request of a cancelled turn with its cancelled outcome.
    this.cancelPending()
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closing = true
      this.closed = this.process.kill().then(() => {})
    }
    return this.closed
  }

  subscribe(listener: AcpEventListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  events(): AsyncIterableIterator<AcpSessionEvent> {
    const queue: AcpSessionEvent[] = []
    let wake: (() => void) | undefined
    let done = this.status === 'closed'
    const unsubscribe = this.subscribe((event) => {
      queue.push(event)
      if (event.kind === 'exited') done = true
      wake?.()
    })
    const iterator: AsyncIterableIterator<AcpSessionEvent> = {
      async next() {
        while (queue.length === 0) {
          if (done) return { done: true, value: undefined }
          await new Promise<void>((resolve) => { wake = resolve })
          wake = undefined
        }
        return { done: false, value: queue.shift()! }
      },
      async return() {
        unsubscribe()
        done = true
        return { done: true, value: undefined }
      },
      [Symbol.asyncIterator]() {
        return this
      },
    }
    return iterator
  }

  private emit(payload: AcpEventPayload): void {
    const event = { seq: ++this.seq, at: new Date().toISOString(), sessionId: this.id, ...payload } as AcpSessionEvent
    for (const listener of [...this.listeners]) listener(event)
  }

  private onUpdate(params: SessionNotification): void {
    if (params.sessionId !== this.upstreamSessionId) return
    if (params.update.sessionUpdate === 'config_option_update') this.configOptions = params.update.configOptions
    this.emit(mapUpdate(params.update))
  }

  private ask<Response>(fallback: Response, payload: (requestId: string) => AcpEventPayload): Promise<Response> {
    return new Promise<Response>((resolve) => {
      const requestId = randomUUID()
      let settled = false
      this.pending.set(requestId, {
        fallback,
        settle: (response) => {
          if (settled) return
          settled = true
          this.pending.delete(requestId)
          resolve(response as Response)
        },
      })
      this.emit(payload(requestId))
      if (this.status === 'closed') this.cancelPending(false)
    })
  }

  private answer(requestId: string, response: unknown): boolean {
    const request = this.pending.get(requestId)
    if (!request) return false
    request.settle(response)
    return true
  }

  private cancelPending(settle = true): void {
    for (const [requestId, request] of [...this.pending]) {
      if (settle) request.settle(request.fallback)
      else this.pending.delete(requestId)
      this.emit({ kind: 'request_cancelled', requestId })
    }
  }
}

function withoutKind<T extends { sessionUpdate: string }>(update: T): Omit<T, 'sessionUpdate'> {
  const copy: Partial<T> = { ...update }
  delete copy.sessionUpdate
  return copy as Omit<T, 'sessionUpdate'>
}

function mapUpdate(update: SessionUpdate): AcpEventPayload {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return update.content.type === 'text' ? { kind: 'text', role: 'agent', text: update.content.text } : { kind: 'other', update }
    case 'user_message_chunk':
      return update.content.type === 'text' ? { kind: 'text', role: 'user', text: update.content.text } : { kind: 'other', update }
    case 'agent_thought_chunk':
      return update.content.type === 'text' ? { kind: 'reasoning', text: update.content.text } : { kind: 'other', update }
    case 'tool_call':
      return { kind: 'tool_call', toolCall: withoutKind(update) }
    case 'tool_call_update':
      return { kind: 'tool_result', update: withoutKind(update) }
    case 'usage_update':
      return { kind: 'usage', usage: withoutKind(update) }
    default:
      return { kind: 'other', update }
  }
}

export type AcpSessionHandle = AcpSessionImpl

/** Spawns the process at once so a registry can kill it even if the handshake never completes. */
export function createAcpSessionHandle(options: StartAcpSessionOptions): AcpSessionHandle {
  if (!isAbsolute(options.cwd)) throw new AcpStartError(options.family, 'cwd must be an absolute path')
  return new AcpSessionImpl(options)
}
