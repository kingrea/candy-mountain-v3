import { createHash } from 'node:crypto'
import { BOT_SECRET_LABELS, BOT_SECRET_NAMES, type BotSlackConnection, type BotSlackReasonCode } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { botSecretOwner, computeBotStatus, createBotSecrets, type BotReadDeps } from '../bots'
import { bots, projects } from '../db/schema'
import { resolvePluginInstance } from '../plugins/instances/instances'
import { createSlackClient, createSlackOperations, type SlackClient, type SlackClientOptions, type SlackOperations } from '../plugins/slack'
import { SecretsLockedError } from '../secrets'
import { createSlackEventBus, toSlackBotEvent, type SlackEventBus } from './events'
import { openSocketModeConnection, type SocketModeConnection, type SocketModeOptions } from './socket'

export interface SlackConnectionsOptions {
  /** How often bots are re-read to start, stop or restart connections. */
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
  close(): Promise<void>
}

type BotRow = typeof bots.$inferSelect

interface Managed {
  projectId: string
  fingerprint: string
  connection: SocketModeConnection
}

type Eligibility =
  | { eligible: true, appToken: string, botToken: string }
  | { eligible: false, code: BotSlackReasonCode, reason: string }

const now = () => new Date().toISOString()
const fingerprintOf = (appToken: string, botToken: string) => createHash('sha256').update(`${appToken}\0${botToken}`).digest('hex')

/**
 * Keeps one Socket Mode connection per active bot. Bots are polled rather than hooked so changes made any way are seen;
 * the base-branch check is skipped because a host outage should not drop Slack.
 */
export function startSlackConnections(deps: BotReadDeps, { reconcileMs = SLACK_RECONCILE_MS, socket, log = console }: SlackConnectionsOptions = {}): SlackConnections {
  const bus = createSlackEventBus(log)
  const managed = new Map<string, Managed>()
  const idle = new Map<string, BotSlackConnection>()
  let closed = false

  function evaluate(row: BotRow, archived: boolean, families: Map<string, ReturnType<typeof resolvePluginInstance>>): Eligibility {
    if (archived) return { eligible: false, code: 'archived', reason: 'The project is archived.' }
    const owner = botSecretOwner(row.id)
    const secrets = Object.fromEntries(BOT_SECRET_NAMES.map(name => [name, deps.secrets.isSet(owner, name) ? 'set' : 'unset'])) as Record<(typeof BOT_SECRET_NAMES)[number], 'set' | 'unset'>
    const missing = BOT_SECRET_NAMES.filter(name => secrets[name] !== 'set')
    if (missing.length > 0) return { eligible: false, code: 'missing_keys', reason: `${missing.map(name => BOT_SECRET_LABELS[name]).join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not set.` }

    const familyKey = `${row.projectId}:${row.family}`
    if (!families.has(familyKey)) families.set(familyKey, resolvePluginInstance(deps, row.projectId, row.family))
    const status = computeBotStatus({
      family: row.family,
      familyPlugin: families.get(familyKey) ?? null,
      persona: { name: row.personaName, status: row.personaStatus, reason: row.personaReason },
      secrets,
      baseBranchProblem: null,
    })
    if (status !== 'active') {
      const warnings = typeof status === 'object' ? status.warnings.join('; ') : 'not configured'
      return { eligible: false, code: 'inactive', reason: `The bot is not active: ${warnings}.` }
    }

    try {
      const tokens = createBotSecrets(deps.secretsReader, row.id)
      const appToken = tokens.get('slackAppToken')
      const botToken = tokens.get('slackBotToken')
      if (!appToken || !botToken) return { eligible: false, code: 'missing_keys', reason: 'Slack keys are not set.' }
      return { eligible: true, appToken, botToken }
    }
    catch (error) {
      if (error instanceof SecretsLockedError) return { eligible: false, code: 'secrets_locked', reason: 'Secrets are locked: the daemon was started without its secrets key.' }
      return { eligible: false, code: 'error', reason: `The Slack keys could not be read: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

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

  function start(row: BotRow, appToken: string, botToken: string) {
    const botId = row.id
    const projectId = row.projectId
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
    const rows = deps.db.select({ bot: bots, archivedAt: projects.archivedAt }).from(bots).innerJoin(projects, eq(projects.id, bots.projectId)).all()
    const families = new Map<string, ReturnType<typeof resolvePluginInstance>>()
    const seen = new Set<string>()
    for (const { bot, archivedAt } of rows) {
      seen.add(bot.id)
      const result = evaluate(bot, archivedAt !== null, families)
      if (!result.eligible) {
        stop(bot.id)
        setIdle(bot.id, result.code, result.reason)
        continue
      }
      const current = managed.get(bot.id)
      if (current?.fingerprint === fingerprintOf(result.appToken, result.botToken)) continue
      stop(bot.id)
      start(bot, result.appToken, result.botToken)
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
      const token = createBotSecrets(deps.secretsReader, botId).get('slackBotToken')
      if (!token) return null
      return { client: createSlackClient(token, options), operations: createSlackOperations({}, { get: () => token }, options) }
    },
    reconcile: safeReconcile,
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
