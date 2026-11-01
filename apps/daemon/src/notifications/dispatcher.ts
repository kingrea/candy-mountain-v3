import { DEPLOY_OUTCOMES, projectViewRoute, type ActivityEvent, type NotificationKind } from '@candy-mountain/shared'
import { subscribeActivityEvents } from '../activity/events'
import type { NotificationChannel, NotificationDelivery } from '../capabilities/definition'
import type { Db } from '../db'
import { findProjectById } from '../projects/projects'
import { DEFAULT_WEB_URL } from './config'
import { claimNotificationEvent, readNotificationRules, recordNotificationOutcome } from './rules'

export interface NotificationDispatcherDeps {
  db: Db
  /** Tried in order; the first to accept wins, and a delivery none accepts is recorded as a failure. */
  channels: readonly NotificationChannel[]
  scopeUrlPrefix: string
}

export interface NotificationDispatcherOptions {
  webUrl?: string
  /** Per delivery, covering everything a channel does for it. */
  timeoutMs?: number
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

export function absoluteLink(webUrl: string, path: string): string {
  return `${webUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

export function noDeliveryChannel(channels: readonly NotificationChannel[]): string {
  if (!channels.length) return 'No delivery channel: no capability offers one.'
  return `No delivery channel: ${channels.map(c => c.id).join(', ')} ${channels.length > 1 ? 'have' : 'has'} no identity for this project.`
}

export function startNotificationDispatcher(deps: NotificationDispatcherDeps, { webUrl = DEFAULT_WEB_URL, timeoutMs = NOTIFICATION_TIMEOUT_MS, log = console }: NotificationDispatcherOptions = {}): NotificationDispatcher {
  const inFlight = new Set<Promise<void>>()
  let closed = false

  async function send(event: ActivityEvent, kind: NotificationKind, destination: { channelId: string } | { memberId: string }, signal: AbortSignal) {
    const slug = findProjectById(deps.db, event.projectId)?.slug
    const url = absoluteLink(webUrl, event.link ?? (slug ? projectViewRoute(deps.scopeUrlPrefix, slug, '') : '/'))
    const delivery: NotificationDelivery = { workspaceId: event.projectId, kind, destination, title: event.title, url }
    for (const channel of deps.channels) {
      if (await channel.deliver(delivery, signal)) return
    }
    throw new Error(noDeliveryChannel(deps.channels))
  }

  async function deliver(event: ActivityEvent, kind: NotificationKind, destination: { channelId: string } | { memberId: string }) {
    const signal = AbortSignal.timeout(timeoutMs)
    try {
      await send(event, kind, destination, signal)
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
