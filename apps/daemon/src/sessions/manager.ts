import { randomUUID } from 'node:crypto'
import type { CreateElicitationResponse, RequestPermissionResponse, SessionConfigOption } from '@agentclientprotocol/sdk'
import { AGENT_SESSION_FAMILY_NAMES, type AgentSession, type AgentSessionEvent, type AgentSessionEventPayload, type AgentSessionFamily, type AgentSessionPosture, type AgentSessionStatus } from '@candy-mountain/shared'
import { AcpAuthRequiredError, AcpLaunchError, assertClaudeNeverBypass, assertCodexLaunchOptions, type AcpHarness, type AcpSession, type AcpSessionEvent, type LaunchMcpServer, type StartSessionOptions } from '../acp'
import { appendActivityEvent } from '../activity'
import type { DataPaths } from '../data-dir'
import { claudeCodeLaunchContext, codexLaunchContext } from '../plugins'
import type { PluginInstanceDeps, SecretsReader } from '../plugins/instances/instances'
import { DEFAULT_SESSION_IDLE_TIMEOUT, DEFAULT_SESSION_MAX_LIVE, resolveSessionSettings, type SessionSettings } from './config'
import { SessionError } from './errors'
import { appendSessionEvent, findSession, insertSession, listSessionEvents, listSessions, resetSessionStatuses, updateSession } from './store'

export interface SessionManagerDeps extends PluginInstanceDeps {
  paths: DataPaths
  secretsReader: SecretsReader
  harness: AcpHarness
  /** Daemon-hosted MCP servers for one launch of the session. */
  mcpServers?: (session: AgentSession) => Promise<LaunchMcpServer[]>
}

export interface SessionManagerOptions extends Partial<SessionSettings> {
  reapIntervalMs?: number
  now?: () => number
  onDiagnostic?: (message: string) => void
}

export interface CreateSessionInput {
  projectId: string
  family: AgentSessionFamily
  actorId: string
  /** Absolute checkout or worktree; the REST route passes the project checkout. */
  cwd: string
  posture?: AgentSessionPosture | null
  /** Chosen by the caller when something (a worktree lease) must be keyed on the id before the row exists. */
  id?: string
  /** Names the bot in the `session.started` activity event. */
  bot?: { id: string, name: string }
}

export type SessionMessage =
  | { type: 'event', event: AgentSessionEvent }
  | { type: 'status', status: AgentSessionStatus }
export type SessionListener = (message: SessionMessage) => void
/** Sees every session's messages, after that session's own listeners. */
export type SessionObserver = (sessionId: string, message: SessionMessage) => void

/** A turn the daemon runs itself for a family no harness launches; rows go through `emit`, cancel arrives on `signal`. */
export interface NativeTurn {
  emit(payload: AgentSessionEventPayload): void
  signal: AbortSignal
}
export type NativeTurnRunner = (turn: NativeTurn) => Promise<void>

export interface PendingSessionRequest {
  requestId: string
  kind: 'permission_request' | 'question'
}

export interface SessionManager {
  readonly settings: SessionSettings
  /** Aborted by close(); streams end on it. */
  readonly signal: AbortSignal
  create(input: CreateSessionInput): AgentSession
  list(projectId: string): AgentSession[]
  get(id: string): AgentSession | null
  events(id: string, options?: { after?: number }): AgentSessionEvent[]
  /** Starts or resumes the live process when needed and sends the turn; resolves once the turn is running or queued. */
  prompt(id: string, text: string): Promise<AgentSession>
  cancel(id: string): Promise<AgentSession>
  /** Logs the prompt, runs the turn in-process and settles it with turn_end; resolves once the turn is running. */
  run(id: string, text: string, runner: NativeTurnRunner): Promise<AgentSession>
  subscribe(id: string, listener: SessionListener): () => void
  observe(observer: SessionObserver): () => void
  /** Appends a row of the daemon's own (decisions) to the log and publishes it; undefined once closed. */
  record(id: string, payload: AgentSessionEventPayload): AgentSessionEvent | undefined
  /** Requests of the running turn that are still unanswered on the live process. */
  pendingRequests(id: string): PendingSessionRequest[]
  /** False once the request was answered, voided or the process is gone. */
  respondToPermission(id: string, requestId: string, response: RequestPermissionResponse): boolean
  respondToQuestion(id: string, requestId: string, response: CreateElicitationResponse): boolean
  liveCount(): number
  /** What the family's agent offered to configure in this project since boot: one set per model it ran with, latest last. */
  configOptions(projectId: string, family: AgentSessionFamily): SessionConfigOption[][]
  close(): Promise<void>
}

type PendingEntry =
  | { kind: 'permission_request', respond: (response: RequestPermissionResponse) => boolean }
  | { kind: 'question', respond: (response: CreateElicitationResponse) => boolean }

interface Live {
  sessionId: string
  acp: AcpSession
  lastActivity: number
  turn: Promise<void> | null
  pending: Map<string, PendingEntry>
}

interface QueuedPrompt {
  sessionId: string
  text: string
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

function toPayload(event: AcpSessionEvent): AgentSessionEventPayload {
  const payload: Record<string, unknown> = { ...event }
  delete payload.seq
  delete payload.at
  delete payload.sessionId
  delete payload.respond
  return payload as unknown as AgentSessionEventPayload
}

export function createSessionManager(deps: SessionManagerDeps, options: SessionManagerOptions = {}): SessionManager {
  const defaults = resolveSessionSettings({ CM_SESSION_IDLE_TIMEOUT: DEFAULT_SESSION_IDLE_TIMEOUT, CM_SESSION_MAX_LIVE: String(DEFAULT_SESSION_MAX_LIVE) })
  const settings: SessionSettings = { idleTimeoutMs: options.idleTimeoutMs ?? defaults.idleTimeoutMs, maxLive: options.maxLive ?? defaults.maxLive }
  const now = options.now ?? Date.now
  const diagnostic = options.onDiagnostic ?? (() => {})
  const { db, harness } = deps
  const lives = new Map<string, Live>()
  const starting = new Set<string>()
  const natives = new Map<string, { controller: AbortController, done: Promise<void> }>()
  const queue: QueuedPrompt[] = []
  const listeners = new Map<string, Set<SessionListener>>()
  const observers = new Set<SessionObserver>()
  const configCatalog = new Map<string, Map<string, SessionConfigOption[]>>()
  const outbox: Array<[string, SessionMessage]> = []
  let flushing = false
  const controller = new AbortController()
  let closed = false
  let closing = false

  resetSessionStatuses(db)

  // A listener may append rows of its own; queueing keeps every listener seeing rows in seq order.
  const publish = (id: string, message: SessionMessage) => {
    outbox.push([id, message])
    if (flushing) return
    flushing = true
    try {
      for (let next = outbox.shift(); next; next = outbox.shift()) {
        const [sessionId, queued] = next
        for (const listener of [...(listeners.get(sessionId) ?? [])]) listener(queued)
        for (const observer of [...observers]) observer(sessionId, queued)
      }
    }
    finally {
      flushing = false
    }
  }

  /** While shutting down the database may already be gone; the exit rows are nice to have, not required. */
  function write<T>(id: string, action: () => T): T | undefined {
    if (closed) return undefined
    try {
      return action()
    }
    catch (error) {
      if (!closing) throw error
      diagnostic(`session ${id}: ${errorMessage(error)}`)
      return undefined
    }
  }

  function setStatus(id: string, status: AgentSessionStatus): void {
    if (write(id, () => { updateSession(db, id, { status, lastActivityAt: new Date(now()).toISOString() }); return true })) publish(id, { type: 'status', status })
  }

  function append(id: string, payload: AgentSessionEventPayload, at = new Date(now()).toISOString()): AgentSessionEvent | undefined {
    const event = write(id, () => appendSessionEvent(db, id, payload, at))
    if (event) publish(id, { type: 'event', event })
    return event
  }

  function getRow(id: string): AgentSession {
    const row = findSession(db, id)
    if (!row) throw new SessionError('not_found', `No session with id "${id}"`)
    return row
  }

  function launchFor(row: AgentSession): StartSessionOptions {
    if (row.family === 'platform') throw new SessionError('family_unavailable', 'Platform agent sessions run in-process; prompt them through their chat thread.')
    const base = { family: row.family, cwd: row.cwd, upstreamSessionId: row.upstreamSessionId ?? undefined }
    if (row.family === 'claude-code') {
      let context
      try {
        context = claudeCodeLaunchContext(deps, row.projectId)
      }
      catch (error) {
        throw new SessionError('family_unavailable', errorMessage(error))
      }
      if (!context) throw new SessionError('family_unavailable', 'The Claude Code plugin is not set up for this project.')
      return { ...base, configHome: context.configDir, command: context.command, env: { ...row.posture?.env, ...context.env }, flags: row.posture?.flags }
    }
    const context = codexLaunchContext(deps, row.projectId)
    if (!context) throw new SessionError('family_unavailable', 'The Codex plugin is not set up for this project.')
    return { ...base, configHome: context.home, command: context.command, env: row.posture?.env, codex: row.posture?.codex }
  }

  // The efforts an agent offers depend on its current model, so one set is kept per model.
  function rememberConfig(row: AgentSession, options: readonly SessionConfigOption[]): void {
    if (!options.length) return
    const key = `${row.projectId}\0${row.family}`
    const byModel = configCatalog.get(key) ?? new Map<string, SessionConfigOption[]>()
    configCatalog.set(key, byModel)
    const model = options.find(option => option.category === 'model')?.currentValue
    const modelKey = typeof model === 'string' ? model : ''
    byModel.delete(modelKey)
    byModel.set(modelKey, structuredClone([...options]))
  }

  const slotsFree = () => lives.size + starting.size < settings.maxLive

  function onEvent(live: Live, event: AcpSessionEvent): void {
    const id = live.sessionId
    live.lastActivity = now()
    if (event.kind === 'permission_request') live.pending.set(event.requestId, { kind: 'permission_request', respond: event.respond })
    else if (event.kind === 'question') live.pending.set(event.requestId, { kind: 'question', respond: event.respond })
    else if (event.kind === 'request_cancelled') live.pending.delete(event.requestId)
    else if (event.kind === 'exited') {
      lives.delete(id)
      live.pending.clear()
    }
    append(id, toPayload(event), event.at)
    if (event.kind === 'turn_end' && lives.get(id) === live) setStatus(id, 'live')
    if (event.kind === 'exited') {
      setStatus(id, 'idle')
      drainQueue()
    }
  }

  function runTurn(live: Live, text: string): void {
    const id = live.sessionId
    live.lastActivity = now()
    setStatus(id, 'prompting')
    live.turn = live.acp.prompt(text).then(() => {}, () => {}).finally(() => {
      live.turn = null
      live.lastActivity = now()
      if (lives.get(id) === live && live.acp.status !== 'closed' && findSession(db, id)?.status === 'prompting') setStatus(id, 'live')
      drainQueue()
    })
  }

  /** Resolves once the process is up and the turn has been sent; rejects only when `surface` is set. */
  async function startAndPrompt(id: string, text: string, surface: boolean): Promise<void> {
    starting.add(id)
    setStatus(id, 'starting')
    let acp: AcpSession
    let row: AgentSession
    try {
      row = getRow(id)
      const launch = launchFor(row)
      const mcpServers = await deps.mcpServers?.(row) ?? []
      acp = await harness.startSession(mcpServers.length ? { ...launch, mcpServers } : launch)
    }
    catch (error) {
      starting.delete(id)
      let failure: SessionError
      if (error instanceof AcpAuthRequiredError) {
        append(id, { kind: 'auth_required', message: error.message })
        failure = new SessionError('auth_required', `${AGENT_SESSION_FAMILY_NAMES[error.family]} is not logged in for this project; log in on its plugin page and try again.`)
      }
      else {
        failure = error instanceof SessionError ? error : new SessionError('agent_failed', errorMessage(error))
        append(id, { kind: 'error', phase: 'start', message: failure.message, code: null })
      }
      append(id, { kind: 'turn_end', stopReason: 'cancelled', usage: null })
      setStatus(id, 'idle')
      drainQueue()
      if (surface) throw failure
      diagnostic(`session ${id}: ${failure.message}`)
      return
    }
    starting.delete(id)
    const live: Live = { sessionId: id, acp, lastActivity: now(), turn: null, pending: new Map() }
    lives.set(id, live)
    rememberConfig(row, acp.configOptions)
    if (!closed) updateSession(db, id, { upstreamSessionId: acp.upstreamSessionId })
    // Subscribed after the handshake on purpose: the history an agent replays on session/load is already in the log.
    acp.subscribe(event => onEvent(live, event))
    if (acp.status === 'closed') {
      lives.delete(id)
      setStatus(id, 'idle')
      return
    }
    setStatus(id, 'live')
    runTurn(live, text)
  }

  function reap(live: Live): void {
    void live.acp.close()
  }

  function drainQueue(): void {
    if (closed) return
    while (queue.length > 0 && slotsFree()) {
      const next = queue.shift()!
      void startAndPrompt(next.sessionId, next.text, false)
    }
    if (queue.length === 0) return
    // Make room now rather than when the idle timeout fires.
    const victim = [...lives.values()].filter(live => live.turn === null).sort((a, b) => a.lastActivity - b.lastActivity)[0]
    if (victim) reap(victim)
  }

  function reapIdle(): void {
    const cutoff = now() - settings.idleTimeoutMs
    for (const live of lives.values()) {
      if (live.turn === null && live.lastActivity <= cutoff) reap(live)
    }
  }

  const reaper = setInterval(reapIdle, options.reapIntervalMs ?? Math.min(30_000, Math.max(250, settings.idleTimeoutMs / 10)))
  reaper.unref()

  return {
    settings,
    signal: controller.signal,

    create(input) {
      try {
        if (input.family === 'claude-code' && input.posture?.flags) assertClaudeNeverBypass(input.posture.flags)
        if (input.family === 'codex' && input.posture?.codex) assertCodexLaunchOptions(input.posture.codex)
      }
      catch (error) {
        if (error instanceof AcpLaunchError) throw new SessionError('invalid_request', error.message)
        throw error
      }
      const at = new Date(now()).toISOString()
      const session = insertSession(db, {
        id: input.id ?? randomUUID(),
        projectId: input.projectId,
        family: input.family,
        actorId: input.actorId,
        cwd: input.cwd,
        upstreamSessionId: null,
        status: 'idle',
        posture: input.posture ?? null,
        createdAt: at,
        lastActivityAt: at,
      })
      appendActivityEvent(db, {
        projectId: input.projectId,
        type: 'session.started',
        title: input.bot ? `Bot "${input.bot.name}" session started` : `${AGENT_SESSION_FAMILY_NAMES[input.family]} session started`,
        payload: { sessionId: session.id, family: input.family, actorId: input.actorId, ...(input.bot ? { botId: input.bot.id, botName: input.bot.name } : {}) },
      })
      return session
    },

    list: projectId => listSessions(db, projectId),
    get: id => findSession(db, id),
    events: (id, options) => listSessionEvents(db, id, options),

    async prompt(id, text) {
      if (closing) throw new SessionError('agent_failed', 'The daemon is shutting down')
      const row = getRow(id)
      if (row.status !== 'idle' && row.status !== 'live') throw new SessionError('session_busy', `The session is ${row.status}; wait for the turn to end or cancel it`)
      const live = lives.get(id)
      if (live) {
        if (live.turn) throw new SessionError('session_busy', 'A turn is already running')
        append(id, { kind: 'prompt', text })
        runTurn(live, text)
        return getRow(id)
      }
      launchFor(row)
      append(id, { kind: 'prompt', text })
      if (!slotsFree()) {
        setStatus(id, 'queued')
        queue.push({ sessionId: id, text })
        drainQueue()
        return getRow(id)
      }
      await startAndPrompt(id, text, true)
      return getRow(id)
    },

    async run(id, text, runner) {
      if (closing) throw new SessionError('agent_failed', 'The daemon is shutting down')
      const row = getRow(id)
      if (natives.has(id) || (row.status !== 'idle' && row.status !== 'live')) throw new SessionError('session_busy', `The session is ${row.status}; wait for the turn to end or cancel it`)
      append(id, { kind: 'prompt', text })
      setStatus(id, 'prompting')
      const controller = new AbortController()
      const done = (async () => {
        let stopReason = 'end_turn'
        try {
          await runner({ emit: payload => void append(id, payload), signal: controller.signal })
        }
        catch (error) {
          append(id, { kind: 'error', phase: 'prompt', message: errorMessage(error), code: null })
          stopReason = 'error'
        }
        finally {
          natives.delete(id)
          append(id, { kind: 'turn_end', stopReason: controller.signal.aborted ? 'cancelled' : stopReason, usage: null })
          setStatus(id, 'idle')
        }
      })()
      natives.set(id, { controller, done })
      return getRow(id)
    },

    async cancel(id) {
      const row = getRow(id)
      const native = natives.get(id)
      if (native) {
        native.controller.abort()
        await native.done
        return getRow(id)
      }
      const queued = queue.findIndex(entry => entry.sessionId === id)
      if (queued >= 0) {
        queue.splice(queued, 1)
        append(id, { kind: 'turn_end', stopReason: 'cancelled', usage: null })
        setStatus(id, 'idle')
        return getRow(id)
      }
      const live = lives.get(id)
      if (live?.turn) {
        await live.acp.cancel()
        await live.turn
      }
      return row.status === 'prompting' || live?.turn ? getRow(id) : row
    },

    subscribe(id, listener) {
      const set = listeners.get(id) ?? new Set()
      listeners.set(id, set)
      set.add(listener)
      return () => {
        set.delete(listener)
        if (set.size === 0) listeners.delete(id)
      }
    },

    observe(observer) {
      observers.add(observer)
      return () => observers.delete(observer)
    },

    record: (id, payload) => append(id, payload),

    pendingRequests(id) {
      return [...(lives.get(id)?.pending ?? [])].map(([requestId, entry]) => ({ requestId, kind: entry.kind }))
    },

    respondToPermission(id, requestId, response) {
      const live = lives.get(id)
      const entry = live?.pending.get(requestId)
      if (!live || entry?.kind !== 'permission_request') return false
      live.pending.delete(requestId)
      return entry.respond(response)
    },

    respondToQuestion(id, requestId, response) {
      const live = lives.get(id)
      const entry = live?.pending.get(requestId)
      if (!live || entry?.kind !== 'question') return false
      live.pending.delete(requestId)
      return entry.respond(response)
    },

    liveCount: () => lives.size + starting.size,
    configOptions: (projectId, family) => structuredClone([...(configCatalog.get(`${projectId}\0${family}`)?.values() ?? [])]),

    async close() {
      if (closing) return
      closing = true
      clearInterval(reaper)
      for (const entry of queue.splice(0)) {
        append(entry.sessionId, { kind: 'turn_end', stopReason: 'cancelled', usage: null })
        setStatus(entry.sessionId, 'idle')
      }
      controller.abort()
      for (const native of natives.values()) native.controller.abort()
      await Promise.all([...natives.values()].map(native => native.done))
      await Promise.all([...lives.values()].map(live => live.acp.close().then(() => live.acp.exited).then(() => {}, () => {})))
      closed = true
      lives.clear()
      listeners.clear()
      observers.clear()
    },
  }
}
