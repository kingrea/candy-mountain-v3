import { DEPLOY_OUTCOMES, type ActivityEvent, type NotificationKind } from '@candy-mountain/shared'
import { eq, sql } from 'drizzle-orm'
import { subscribeActivityEvents } from '../activity/events'
import { botSecretOwner } from '../bots/bots'
import { bots } from '../db/schema'
import { resolvePluginInstance, type PluginInstanceDeps, type SecretsReader } from '../plugins/instances/instances'
import { createPluginSecrets } from '../plugins/secrets'
import { createSlackOperations, slackConfig, slackPluginType, type SlackOperations } from '../plugins/slack'
import { findProjectById } from '../projects/projects'
import type { SlackConnections } from '../slack/manager'
import { DEFAULT_WEB_URL } from './config'
import { claimNotificationEvent, readNotificationRules, recordNotificationOutcome } from './rules'

export interface NotificationDispatcherDeps extends PluginInstanceDeps {
  secretsReader: SecretsReader
  slack: Pick<SlackConnections, 'web'>
}

export interface NotificationDispatcherOptions {
  webUrl?: string
  /** Per delivery, covering the DM open and the post together. */
  timeoutMs?: number
  fetch?: typeof fetch
  log?: Pick<Console, 'error'>
}

export interface NotificationDispatcher {
  /** Hands an event to the dispatcher as if it had just been appended; appends on the platform database arrive on their own. */
  notify(event: ActivityEvent): void
  /** Resolves once every delivery in flight has finished. */
  idle(): Promise<void>
  close(): void
}

export const NOTIFICATION_TIMEOUT_MS = 10_000

export function notificationKindOf(event: Pick<ActivityEvent, 'type' | 'payload'>): NotificationKind | null {
  switch (event.type) {
    case 'bot.handoff': return 'bot.finished'
    case 'incident.opened': return 'incident.opened'
    case 'incident.closed': return 'incident.closed'
    case 'deploy.attempted': {
      const outcome = event.payload?.outcome
      if (outcome === DEPLOY_OUTCOMES[0]) return 'deploy.succeeded'
      if (outcome === DEPLOY_OUTCOMES[1]) return 'deploy.failed'
      return null
    }
    default: return null
  }
}

const escapeMrkdwn = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function absoluteLink(webUrl: string, path: string): string {
  return `${webUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

interface Sender {
  operations: SlackOperations
  via: string
}

const NO_IDENTITY = 'No Slack identity: the project has no bot with a Slack bot token and there is no platform Slack plugin instance.'

export function startNotificationDispatcher(deps: NotificationDispatcherDeps, { webUrl = DEFAULT_WEB_URL, timeoutMs = NOTIFICATION_TIMEOUT_MS, fetch, log = console }: NotificationDispatcherOptions = {}): NotificationDispatcher {
  const inFlight = new Set<Promise<void>>()
  let closed = false

  function resolveSender(projectId: string, signal: AbortSignal): Sender | null {
    const rows = deps.db.select({ id: bots.id }).from(bots).where(eq(bots.projectId, projectId)).orderBy(sql`lower(${bots.name})`, bots.createdAt).all()
    for (const { id } of rows) {
      if (!deps.secrets.isSet(botSecretOwner(id), 'slackBotToken')) continue
      const web = deps.slack.web(id, { fetch, signal })
      if (web) return { operations: web.operations, via: `bot ${id}` }
    }
    const instance = resolvePluginInstance(deps, projectId, 'slack')
    if (!instance) return null
    const secrets = createPluginSecrets(deps.secretsReader, instance.id, slackPluginType)
    return { operations: createSlackOperations(slackConfig(instance.config), secrets, { fetch, signal }), via: 'the platform Slack plugin' }
  }

  async function deliver(event: ActivityEvent, kind: NotificationKind, destination: { channelId: string } | { memberId: string }) {
    const signal = AbortSignal.timeout(timeoutMs)
    try {
      const sender = resolveSender(event.projectId, signal)
      if (!sender) throw new Error(NO_IDENTITY)
      const slug = findProjectById(deps.db, event.projectId)?.slug
      const url = absoluteLink(webUrl, event.link ?? (slug ? `/p/${slug}` : '/'))
      const target = 'channelId' in destination ? { channel: destination.channelId } : { memberId: destination.memberId }
      await sender.operations.postMessage({ ...target, text: `${escapeMrkdwn(event.title)}\n<${url}|Open in Candy Mountain>` })
      recordNotificationOutcome(deps.db, event.projectId, kind, { ok: true, at: new Date().toISOString() })
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      log.error(`Notification ${kind} for event ${event.id} failed: ${reason}`)
      try {
        recordNotificationOutcome(deps.db, event.projectId, kind, { ok: false, at: new Date().toISOString(), reason })
      }
      catch (recordError) {
        log.error('Recording the notification failure failed:', recordError)
      }
    }
  }

  function notify(event: ActivityEvent) {
    if (closed) return
    const kind = notificationKindOf(event)
    if (!kind) return
    const rule = readNotificationRules(deps.db, event.projectId)[kind]
    if (!rule.enabled || !rule.destination) return
    if (!claimNotificationEvent(deps.db, event.projectId, event.id)) return
    const task = deliver(event, kind, rule.destination).finally(() => inFlight.delete(task))
    inFlight.add(task)
  }

  const unsubscribe = subscribeActivityEvents(deps.db, notify)

  return {
    notify,
    idle: async () => {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight])
    },
    close() {
      closed = true
      unsubscribe()
    },
  }
}
