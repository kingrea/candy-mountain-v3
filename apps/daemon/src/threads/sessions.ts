import { randomUUID } from 'node:crypto'
import type { SessionConfigOption } from '@agentclientprotocol/sdk'
import type { AgentSession, AgentSessionEvent, AgentSessionEventPayload, AgentSessionFamily, AgentSessionPosture, AgentSessionStatus } from '@candy-mountain/shared'
import { appendActivityEvent } from '../activity'
import { serviceKey } from '../capabilities/definition'
import type { Db } from '../db'
import { SessionError } from '../sessions/errors'
import type { SessionFamilyRegistry } from './families'
import { appendSessionEvent, findSession, insertSession, listSessionEvents, listSessions, resetSessionStatuses, updateSession, type SessionPatch } from '../sessions/store'

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

/** The path that prompts sessions of the families the daemon does not run itself (today the ACP harness); the capability that owns it attaches one. */
export interface SessionDriver {
  /** Throws a SessionError for a posture the family refuses, before the row exists. */
  assertPosture(family: AgentSessionFamily, posture: AgentSessionPosture): void
  prompt(id: string, text: string): Promise<AgentSession>
  /** Reached once no native turn of the session was found to abort. */
  cancel(id: string, row: AgentSession): Promise<AgentSession>
  configOptions(projectId: string, family: AgentSessionFamily): SessionConfigOption[][]
}

export interface SessionStoreDeps {
  db: Db
  /** Names families in activity titles and errors. */
  families: SessionFamilyRegistry
}

export interface SessionStoreOptions {
  now?: () => number
  onDiagnostic?: (message: string) => void
}

/** Every session's rows, log and listeners, whatever family it is, plus the turns the daemon runs itself; the platform starts one. */
export interface SessionStore {
  /** Aborted by close(); streams end on it. */
  readonly signal: AbortSignal
  create(input: CreateSessionInput): AgentSession
  list(projectId: string): AgentSession[]
  get(id: string): AgentSession | null
  /** The row, or a not_found SessionError. */
  require(id: string): AgentSession
  events(id: string, options?: { after?: number }): AgentSessionEvent[]
  /** Sends the turn through the attached driver; without one no family can be prompted. */
  prompt(id: string, text: string): Promise<AgentSession>
  cancel(id: string): Promise<AgentSession>
  /** Logs the prompt, runs the turn in-process and settles it with turn_end; resolves once the turn is running. */
  run(id: string, text: string, runner: NativeTurnRunner): Promise<AgentSession>
  subscribe(id: string, listener: SessionListener): () => void
  observe(observer: SessionObserver): () => void
  /** Appends a row to the log and publishes it; undefined once closed. */
  record(id: string, payload: AgentSessionEventPayload, at?: string): AgentSessionEvent | undefined
  /** Writes the status and publishes it. */
  setStatus(id: string, status: AgentSessionStatus): void
  update(id: string, patch: SessionPatch): void
  /** What the family's agent offered to configure in this project since boot, from the driver; none without one. */
  configOptions(projectId: string, family: AgentSessionFamily): SessionConfigOption[][]
  /** One per store; a second throws. */
  attach(driver: SessionDriver): void
  close(): Promise<void>
}

/** What the thread service needs of the store. */
export type ThreadSessions = Pick<SessionStore, 'get' | 'subscribe' | 'create' | 'configOptions' | 'run' | 'prompt' | 'cancel'>

export const THREAD_SESSIONS = serviceKey<SessionStore>('threads.sessions')

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createSessionStore({ db, families }: SessionStoreDeps, options: SessionStoreOptions = {}): SessionStore {
  const now = options.now ?? Date.now
  const diagnostic = options.onDiagnostic ?? (() => {})
  const natives = new Map<string, { controller: AbortController, done: Promise<void> }>()
  const listeners = new Map<string, Set<SessionListener>>()
  const observers = new Set<SessionObserver>()
  const outbox: Array<[string, SessionMessage]> = []
  let flushing = false
  const controller = new AbortController()
  let driver: SessionDriver | undefined
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

  return {
    signal: controller.signal,

    create(input) {
      if (input.posture) driver?.assertPosture(input.family, input.posture)
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
        title: input.bot ? `Bot "${input.bot.name}" session started` : `${families.nameOf(input.family)} session started`,
        payload: { sessionId: session.id, family: input.family, actorId: input.actorId, ...(input.bot ? { botId: input.bot.id, botName: input.bot.name } : {}) },
      })
      return session
    },

    list: projectId => listSessions(db, projectId),
    get: id => findSession(db, id),
    require: getRow,
    events: (id, options) => listSessionEvents(db, id, options),

    async prompt(id, text) {
      if (closing) throw new SessionError('agent_failed', 'The daemon is shutting down')
      const row = getRow(id)
      if (!driver) throw new SessionError('family_unavailable', `No agent harness launches ${families.nameOf(row.family)} sessions.`)
      return driver.prompt(id, text)
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
      return driver ? driver.cancel(id, row) : row
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

    record: (id, payload, at) => append(id, payload, at),
    setStatus,
    update(id, patch) {
      write(id, () => { updateSession(db, id, patch); return true })
    },

    configOptions: (projectId, family) => driver?.configOptions(projectId, family) ?? [],

    attach(next) {
      if (driver) throw new Error('The session store already has a driver.')
      driver = next
    },

    async close() {
      if (closing) return
      closing = true
      controller.abort()
      for (const native of natives.values()) native.controller.abort()
      await Promise.all([...natives.values()].map(native => native.done))
      closed = true
      listeners.clear()
      observers.clear()
    },
  }
}
