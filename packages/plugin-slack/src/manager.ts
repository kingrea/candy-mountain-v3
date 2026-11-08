import { createHash } from 'node:crypto'
import type { BotSlackConnection, BotSlackReasonCode } from '@candy-mountain/platform-sdk'
import { createSlackClient, type SlackClient, type SlackClientOptions } from './client'
import { createSlackEventBus, toSlackBotEvent, type SlackEventBus } from './events'
import { createSlackOperations, type SlackOperations } from './operations'
import { openSocketModeConnection, type SocketModeConnection, type SocketModeOptions } from './socket'

/** A bot that should hold a Socket Mode connection, or why it may not. */
export type SlackConnectionTarget = { botId: string, projectId: string } & (
  | { eligible: true, appToken: string, botToken: string }
  | { eligible: false, code: BotSlackReasonCode, reason: string }
)

/** Where a session was started to answer; the MCP server posts nowhere else. */
export interface SlackSessionThread {
  botId: string
  channelId: string
  threadTs: string
  open: boolean
  /** The bot session holder id the thread was opened under. */
  holderId: string
}

export interface SlackNotificationSender {
  id: string
  name: string
}

/**
 * The bots the connections serve, handed in by the capability that owns them (bots depends on slack, never the reverse).
 * Every method is read on each use, so a change made any way is seen.
 */
export interface SlackBotSource {
  connectionTargets(): SlackConnectionTarget[]
  /** Undefined when unset; may throw when secrets are locked. */
  botToken(botId: string): string | undefined
  /** The workspace's bots with a bot token, in the order a notification tries them. */
  notificationSenders(workspaceId: string): SlackNotificationSender[]
  threadForSession(sessionId: string): SlackSessionThread | null
}

export interface SlackConnectionsOptions {
  /** How often the bots are re-read to start, stop or restart connections. */
  reconcileMs?: number
  socket?: SocketModeOptions
  log?: Pick<Console, 'error'>
}

export const SLACK_RECONCILE_MS = 2_000

export interface BotSlackWeb {
  client: SlackClient
  operations: SlackOperations
}

export interface SlackConnections {
  subscribe: SlackEventBus['subscribe']
  status(botId: string): BotSlackConnection
  /** Null when the bot has no bot token. Reads the token on every call, so a key change applies at once. */
  web(botId: string, options?: SlackClientOptions): BotSlackWeb | null
  /** Runs on its own every `reconcileMs`; call it to apply a change without waiting. */
  reconcile(): void
  /** Until a source is attached there are no bots, so nothing connects; attaching reconciles at once. */
  attach(source: SlackBotSource): void
  source(): SlackBotSource | null
  close(): Promise<void>
}

interface Managed {
  projectId: string
  fingerprint: string
  connection: SocketModeConnection
}

const now = () => new Date().toISOString()
const fingerprintOf = (appToken: string, botToken: string) => createHash('sha256').update(`${appToken}\0${botToken}`).digest('hex')

/** Keeps one Socket Mode connection per eligible bot. The source is polled rather than hooked so changes made any way are seen. */
export function startSlackConnections({ reconcileMs = SLACK_RECONCILE_MS, socket, log = console }: SlackConnectionsOptions = {}): SlackConnections {
  const bus = createSlackEventBus(log)
  const managed = new Map<string, Managed>()
  const idle = new Map<string, BotSlackConnection>()
  let source: SlackBotSource | null = null
  let closed = false

  function setIdle(botId: string, code: BotSlackReasonCode, reason: string) {
    const previous = idle.get(botId)
    if (previous?.reasonCode === code && previous.reason === reason) return
    idle.set(botId, { state: 'disconnected', reason, reasonCode: code, since: now(), retryAt: null, identity: null })
  }

  function stop(botId: string) {
    const entry = managed.get(botId)
    if (!entry) return
    managed.delete(botId)
    entry.connection.close().catch(error => log.error('Closing a Slack connection failed:', error))
  }

  function start(botId: string, projectId: string, appToken: string, botToken: string) {
    const connection = openSocketModeConnection({
      appToken,
      botToken,
      options: socket,
      onEnvelope(envelope, self) {
        const event = toSlackBotEvent(envelope, { botId, projectId, receivedAt: now() }, self)
        if (event) bus.emit(event)
      },
    })
    managed.set(botId, { projectId, fingerprint: fingerprintOf(appToken, botToken), connection })
    idle.delete(botId)
  }

  function reconcile() {
    if (closed) return
    const targets = source?.connectionTargets() ?? []
    const seen = new Set<string>()
    for (const target of targets) {
      seen.add(target.botId)
      if (!target.eligible) {
        stop(target.botId)
        setIdle(target.botId, target.code, target.reason)
        continue
      }
      const current = managed.get(target.botId)
      if (current?.fingerprint === fingerprintOf(target.appToken, target.botToken)) continue
      stop(target.botId)
      start(target.botId, target.projectId, target.appToken, target.botToken)
    }
    for (const botId of [...managed.keys(), ...idle.keys()]) {
      if (seen.has(botId)) continue
      stop(botId)
      idle.delete(botId)
    }
  }

  function safeReconcile() {
    try {
      reconcile()
    }
    catch (error) {
      log.error('Reconciling Slack connections failed:', error)
    }
  }

  safeReconcile()
  const timer = setInterval(safeReconcile, reconcileMs)
  timer.unref()

  return {
    subscribe: bus.subscribe,
    status(botId) {
      if (!managed.has(botId) && !idle.has(botId)) safeReconcile()
      return managed.get(botId)?.connection.status()
        ?? idle.get(botId)
        ?? { state: 'disconnected', reason: closed ? 'The connection was stopped.' : 'No such bot.', reasonCode: closed ? 'stopped' : 'inactive', since: now(), retryAt: null, identity: null }
    },
    web(botId, options) {
      const token = source?.botToken(botId)
      if (!token) return null
      return { client: createSlackClient(token, options), operations: createSlackOperations({}, { get: () => token }, options) }
    },
    reconcile: safeReconcile,
    attach(next) {
      source = next
      safeReconcile()
    },
    source: () => source,
    async close() {
      if (closed) return
      closed = true
      clearInterval(timer)
      const connections = [...managed.values()].map(entry => entry.connection.close())
      managed.clear()
      idle.clear()
      await Promise.allSettled(connections)
    },
  }
}
