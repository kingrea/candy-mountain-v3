import type { CreateElicitationResponse, RequestPermissionResponse, SessionConfigOption } from '@agentclientprotocol/sdk'
import type { AgentSession, AgentSessionEvent, AgentSessionEventPayload, AgentSessionFamily, AgentSessionPosture } from '@candy-mountain/shared'
import { AcpAuthRequiredError, AcpLaunchError, isAgentFamily, type AcpHarness, type AcpSession, type AcpSessionEvent, type AgentFamily, type LaunchMcpServer, type StartSessionOptions } from '../acp'
import type { DataPaths } from '../data-dir'
import type { PluginInstanceDeps, SecretsReader } from '../plugins/instances/instances'
import type { CreateSessionInput, NativeTurnRunner, SessionListener, SessionObserver, SessionStore } from '../threads/sessions'
import { DEFAULT_SESSION_IDLE_TIMEOUT, DEFAULT_SESSION_MAX_LIVE, resolveSessionSettings, type SessionSettings } from './config'
import { SessionError } from './errors'
import { createSessionFamilyRegistry, SESSION_FAMILIES, type SessionFamilyRegistry } from '../threads/families'

export type { CreateSessionInput, NativeTurn, NativeTurnRunner, SessionListener, SessionMessage, SessionObserver } from '../threads/sessions'

export interface SessionManagerDeps extends PluginInstanceDeps {
  paths: DataPaths
  secretsReader: SecretsReader
  harness: AcpHarness
  /** The platform's rows, log and listeners; the manager attaches itself as the path that prompts harness families. */
  store: SessionStore
  /** Names families in activity titles and errors; defaults to the daemon's own families. */
  families?: SessionFamilyRegistry
  /** Daemon-hosted MCP servers for one launch of the session. */
  mcpServers?: (session: AgentSession) => Promise<LaunchMcpServer[]>
}

export type SessionLaunchDeps = Pick<SessionManagerDeps, 'db' | 'pluginTypes' | 'secrets' | 'secretsReader' | 'paths'>
export type SessionLaunchBase = Pick<StartSessionOptions, 'family' | 'cwd' | 'upstreamSessionId'>

/** How one ACP family starts; the definition that brings the family registers it, and a family with none refuses to launch. */
export interface SessionLauncher {
  /** Throws an AcpLaunchError for a posture the family must never run with, so create refuses it before the row exists. */
  assertPosture?(posture: AgentSessionPosture): void
  /** Throws a SessionError when the project cannot run the family. */
  launch(row: AgentSession, base: SessionLaunchBase, deps: SessionLaunchDeps): StartSessionOptions
}

export interface SessionManagerOptions extends Partial<SessionSettings> {
  reapIntervalMs?: number
  now?: () => number
  onDiagnostic?: (message: string) => void
}

export interface PendingSessionRequest {
  requestId: string
  kind: 'permission_request' | 'question'
}

export interface SessionManager {
  readonly settings: SessionSettings
  /** Aborted by close(), the store's included; streams end on it. */
  readonly signal: AbortSignal
  /** Throws for a family the registry lacks or one that already has a launcher. */
  registerLauncher(family: AgentFamily, launcher: SessionLauncher): void
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
  /** Ends the live processes and the queue; the store's own close, which the platform runs after, settles the rest. */
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
  const { harness, store } = deps
  const families = deps.families ?? createSessionFamilyRegistry(SESSION_FAMILIES)
  const launchers = new Map<string, SessionLauncher>()
  const lives = new Map<string, Live>()
  const starting = new Set<string>()
  const queue: QueuedPrompt[] = []
  const configCatalog = new Map<string, Map<string, SessionConfigOption[]>>()
  const controller = new AbortController()
  let closed = false
  let closing = false

  const append = store.record
  const setStatus = store.setStatus
  const getRow = store.require

  function launchFor(row: AgentSession): StartSessionOptions {
    if (row.family === 'platform') throw new SessionError('family_unavailable', 'Platform agent sessions run in-process; prompt them through their chat thread.')
    const launcher = launchers.get(row.family)
    if (!launcher || !isAgentFamily(row.family)) throw new SessionError('family_unavailable', `No agent harness launches ${families.nameOf(row.family)} sessions.`)
    return launcher.launch(row, { family: row.family, cwd: row.cwd, upstreamSessionId: row.upstreamSessionId ?? undefined }, deps)
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
      if (lives.get(id) === live && live.acp.status !== 'closed' && store.get(id)?.status === 'prompting') setStatus(id, 'live')
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
        failure = new SessionError('auth_required', `${families.nameOf(error.family)} is not logged in for this project; log in on its plugin page and try again.`)
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
    store.update(id, { upstreamSessionId: acp.upstreamSessionId })
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

  async function prompt(id: string, text: string): Promise<AgentSession> {
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
  }

  const configOptions = (projectId: string, family: AgentSessionFamily) => structuredClone([...(configCatalog.get(`${projectId}\0${family}`)?.values() ?? [])])

  store.attach({
    assertPosture(family, posture) {
      try {
        launchers.get(family)?.assertPosture?.(posture)
      }
      catch (error) {
        if (error instanceof AcpLaunchError) throw new SessionError('invalid_request', error.message)
        throw error
      }
    },
    prompt,
    async cancel(id, row) {
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
    configOptions,
  })

  return {
    settings,
    signal: AbortSignal.any([controller.signal, store.signal]),

    registerLauncher(family, launcher) {
      if (!families.has(family)) throw new Error(`Cannot register a launcher for unregistered session family '${family}'.`)
      if (launchers.has(family)) throw new Error(`Session family '${family}' already has a launcher.`)
      launchers.set(family, launcher)
    },

    create: input => store.create(input),
    list: store.list,
    get: store.get,
    events: store.events,
    prompt,
    run: store.run,
    cancel: store.cancel,
    subscribe: store.subscribe,
    observe: store.observe,
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
    configOptions,

    async close() {
      if (closing) return
      closing = true
      clearInterval(reaper)
      for (const entry of queue.splice(0)) {
        append(entry.sessionId, { kind: 'turn_end', stopReason: 'cancelled', usage: null })
        setStatus(entry.sessionId, 'idle')
      }
      controller.abort()
      await Promise.all([...lives.values()].map(live => live.acp.close().then(() => live.acp.exited).then(() => {}, () => {})))
      closed = true
      lives.clear()
    },
  }
}
