import {
  NOTIFICATION_KINDS,
  SLACK_CHANNEL_ID_PATTERN,
  SLACK_MEMBER_ID_PATTERN,
  type NotificationDestination,
  type NotificationErrorCode,
  type NotificationKind,
  type NotificationRule,
  type NotificationRuleUpdate,
  type NotificationRules,
  type UpdateNotificationRulesRequest,
} from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { platformMeta } from '../db/schema'

export class NotificationError extends Error {
  override name = 'NotificationError'
  readonly status = 400

  constructor(readonly code: NotificationErrorCode, message: string) {
    super(message)
  }
}

export const notificationRulesKey = (projectId: string) => `notifications.${projectId}`
export const notificationDeliveredKey = (projectId: string) => `notifications.delivered.${projectId}`

/** Delivered event ids kept per project; beyond this the oldest are forgotten. */
export const DELIVERED_RING_SIZE = 500

const emptyRule = (): NotificationRule => ({ enabled: false, destination: null, lastFailureAt: null, lastFailureReason: null, lastDeliveredAt: null })

export const emptyNotificationRules = (): NotificationRules =>
  Object.fromEntries(NOTIFICATION_KINDS.map(kind => [kind, emptyRule()])) as NotificationRules

function readJson(db: Db, key: string): unknown {
  const value = db.select({ value: platformMeta.value }).from(platformMeta).where(eq(platformMeta.key, key)).get()?.value
  if (value === undefined) return undefined
  try {
    return JSON.parse(value)
  }
  catch {
    return undefined
  }
}

function writeJson(db: Db, key: string, value: unknown) {
  const updatedAt = new Date().toISOString()
  const text = JSON.stringify(value)
  db.insert(platformMeta).values({ key, value: text, updatedAt }).onConflictDoUpdate({ target: platformMeta.key, set: { value: text, updatedAt } }).run()
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nullableString = (value: unknown) => (typeof value === 'string' ? value : null)

function destinationOf(value: unknown): NotificationDestination | null {
  if (!isRecord(value)) return null
  if (typeof value.channelId === 'string') return { channelId: value.channelId }
  if (typeof value.memberId === 'string') return { memberId: value.memberId }
  return null
}

export function readNotificationRules(db: Db, projectId: string): NotificationRules {
  const stored = readJson(db, notificationRulesKey(projectId))
  const rules = emptyNotificationRules()
  if (!isRecord(stored)) return rules
  for (const kind of NOTIFICATION_KINDS) {
    const raw = stored[kind]
    if (!isRecord(raw)) continue
    rules[kind] = {
      enabled: raw.enabled === true,
      destination: destinationOf(raw.destination),
      lastFailureAt: nullableString(raw.lastFailureAt),
      lastFailureReason: nullableString(raw.lastFailureReason),
      lastDeliveredAt: nullableString(raw.lastDeliveredAt),
    }
  }
  return rules
}

export function writeNotificationRules(db: Db, projectId: string, rules: NotificationRules): void {
  writeJson(db, notificationRulesKey(projectId), rules)
}

function parseDestination(kind: string, value: unknown): NotificationDestination | null {
  if (value === null) return null
  if (!isRecord(value)) throw new NotificationError('invalid_request', `${kind}: destination must be an object or null`)
  const { channelId, memberId } = value
  if (channelId !== undefined && memberId !== undefined) throw new NotificationError('invalid_request', `${kind}: give a channelId or a memberId, not both`)
  if (typeof channelId === 'string') {
    const id = channelId.trim()
    if (!SLACK_CHANNEL_ID_PATTERN.test(id)) throw new NotificationError('invalid_request', `${kind}: '${channelId}' is not a Slack channel id (such as C0123456789)`)
    return { channelId: id }
  }
  if (typeof memberId === 'string') {
    const id = memberId.trim()
    if (!SLACK_MEMBER_ID_PATTERN.test(id)) throw new NotificationError('invalid_request', `${kind}: '${memberId}' is not a Slack member id (such as U0123456789)`)
    return { memberId: id }
  }
  throw new NotificationError('invalid_request', `${kind}: destination needs a channelId or a memberId`)
}

export function parseUpdateNotificationRules(body: unknown): UpdateNotificationRulesRequest {
  if (!isRecord(body) || !isRecord(body.rules)) throw new NotificationError('invalid_request', 'Request body must be { rules: { <kind>: { enabled?, destination? } } }')
  const rules: UpdateNotificationRulesRequest['rules'] = {}
  for (const [kind, raw] of Object.entries(body.rules)) {
    if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) throw new NotificationError('invalid_request', `Unknown notification kind: ${kind}`)
    if (!isRecord(raw)) throw new NotificationError('invalid_request', `${kind}: rule must be an object`)
    const update: NotificationRuleUpdate = {}
    if (raw.enabled !== undefined) {
      if (typeof raw.enabled !== 'boolean') throw new NotificationError('invalid_request', `${kind}: enabled must be a boolean`)
      update.enabled = raw.enabled
    }
    if (raw.destination !== undefined) update.destination = parseDestination(kind, raw.destination)
    rules[kind as NotificationKind] = update
  }
  return { rules }
}

/** Kinds in the request are merged over the stored rule; touching a rule clears its failure so the next attempt is judged afresh. */
export function updateNotificationRules(db: Db, projectId: string, request: UpdateNotificationRulesRequest): NotificationRules {
  const rules = readNotificationRules(db, projectId)
  for (const kind of NOTIFICATION_KINDS) {
    const update = request.rules[kind]
    if (!update) continue
    const next: NotificationRule = {
      ...rules[kind],
      enabled: update.enabled ?? rules[kind].enabled,
      destination: update.destination === undefined ? rules[kind].destination : update.destination,
      lastFailureAt: null,
      lastFailureReason: null,
    }
    if (next.enabled && !next.destination) throw new NotificationError('invalid_request', `${kind}: an enabled rule needs a destination`)
    rules[kind] = next
  }
  writeNotificationRules(db, projectId, rules)
  return rules
}

export type NotificationOutcome = { ok: true, at: string } | { ok: false, at: string, reason: string }

export function recordNotificationOutcome(db: Db, projectId: string, kind: NotificationKind, outcome: NotificationOutcome): void {
  const rules = readNotificationRules(db, projectId)
  rules[kind] = outcome.ok
    ? { ...rules[kind], lastDeliveredAt: outcome.at, lastFailureAt: null, lastFailureReason: null }
    : { ...rules[kind], lastFailureAt: outcome.at, lastFailureReason: outcome.reason }
  writeNotificationRules(db, projectId, rules)
}

/**
 * Marks an event as handled before anything is sent, so a crash mid-delivery drops the message rather than repeating it.
 * Returns false when the id was already claimed.
 */
export function claimNotificationEvent(db: Db, projectId: string, eventId: string): boolean {
  const stored = readJson(db, notificationDeliveredKey(projectId))
  const ids = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
  if (ids.includes(eventId)) return false
  ids.push(eventId)
  writeJson(db, notificationDeliveredKey(projectId), ids.slice(-DELIVERED_RING_SIZE))
  return true
}
