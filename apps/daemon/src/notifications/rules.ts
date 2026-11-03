import {
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
import { eq, inArray } from 'drizzle-orm'
import { activityEventTypesFor, type ActivityEventTypeRegistry } from '../activity/types'
import type { Db } from '../db'
import { platformMeta } from '../db/schema'

export class NotificationError extends Error {
  override name = 'NotificationError'
  readonly status = 400

  constructor(readonly code: NotificationErrorCode, message: string) {
    super(message)
  }
}

export const notificationRulesKey = (workspaceId: string) => `notifications.${workspaceId}`
export const notificationDeliveredKey = (workspaceId: string) => `notifications.delivered.${workspaceId}`

/** platform_meta has no foreign key to cascade from, so deleting a workspace calls this. */
export function deleteNotificationState(db: Db, workspaceId: string): void {
  db.delete(platformMeta).where(inArray(platformMeta.key, [notificationRulesKey(workspaceId), notificationDeliveredKey(workspaceId)])).run()
}

/** Delivered event ids kept per workspace; beyond this the oldest are forgotten. */
export const DELIVERED_RING_SIZE = 500

const emptyRule = (): NotificationRule => ({ enabled: false, destination: null, lastFailureAt: null, lastFailureReason: null, lastDeliveredAt: null })

const kindsOf = (db: Db) => activityEventTypesFor(db).notificationKinds().map(kind => kind.id)

export const emptyNotificationRules = (kinds: readonly NotificationKind[]): NotificationRules =>
  Object.fromEntries(kinds.map(kind => [kind, emptyRule()]))

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

export function readNotificationRules(db: Db, workspaceId: string): NotificationRules {
  const kinds = kindsOf(db)
  const stored = readJson(db, notificationRulesKey(workspaceId))
  const rules = emptyNotificationRules(kinds)
  if (!isRecord(stored)) return rules
  for (const kind of kinds) {
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

/** Stored rules for kinds this product does not register are kept, so they read again once a product registers the kind. */
export function writeNotificationRules(db: Db, workspaceId: string, rules: NotificationRules): void {
  const stored = readJson(db, notificationRulesKey(workspaceId))
  writeJson(db, notificationRulesKey(workspaceId), { ...(isRecord(stored) ? stored : {}), ...rules })
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

export function parseUpdateNotificationRules(body: unknown, kinds: Pick<ActivityEventTypeRegistry, 'hasNotificationKind'>): UpdateNotificationRulesRequest {
  if (!isRecord(body) || !isRecord(body.rules)) throw new NotificationError('invalid_request', 'Request body must be { rules: { <kind>: { enabled?, destination? } } }')
  const rules: UpdateNotificationRulesRequest['rules'] = {}
  for (const [kind, raw] of Object.entries(body.rules)) {
    if (!kinds.hasNotificationKind(kind)) throw new NotificationError('invalid_request', `Unknown notification kind: ${kind}`)
    if (!isRecord(raw)) throw new NotificationError('invalid_request', `${kind}: rule must be an object`)
    const update: NotificationRuleUpdate = {}
    if (raw.enabled !== undefined) {
      if (typeof raw.enabled !== 'boolean') throw new NotificationError('invalid_request', `${kind}: enabled must be a boolean`)
      update.enabled = raw.enabled
    }
    if (raw.destination !== undefined) update.destination = parseDestination(kind, raw.destination)
    rules[kind] = update
  }
  return { rules }
}

/** Kinds in the request are merged over the stored rule; touching a rule clears its failure so the next attempt is judged afresh. */
export function updateNotificationRules(db: Db, workspaceId: string, request: UpdateNotificationRulesRequest): NotificationRules {
  const rules = readNotificationRules(db, workspaceId)
  for (const [kind, rule] of Object.entries(rules)) {
    const update = request.rules[kind]
    if (!update) continue
    const next: NotificationRule = {
      ...rule,
      enabled: update.enabled ?? rule.enabled,
      destination: update.destination === undefined ? rule.destination : update.destination,
      lastFailureAt: null,
      lastFailureReason: null,
    }
    if (next.enabled && !next.destination) throw new NotificationError('invalid_request', `${kind}: an enabled rule needs a destination`)
    rules[kind] = next
  }
  writeNotificationRules(db, workspaceId, rules)
  return rules
}

export type NotificationOutcome = { ok: true, at: string } | { ok: false, at: string, reason: string }

export function recordNotificationOutcome(db: Db, workspaceId: string, kind: NotificationKind, outcome: NotificationOutcome): void {
  const rules = readNotificationRules(db, workspaceId)
  const rule = rules[kind]
  if (!rule) return
  rules[kind] = outcome.ok
    ? { ...rule, lastDeliveredAt: outcome.at, lastFailureAt: null, lastFailureReason: null }
    : { ...rule, lastFailureAt: outcome.at, lastFailureReason: outcome.reason }
  writeNotificationRules(db, workspaceId, rules)
}

/**
 * Marks an event as handled before anything is sent, so a crash mid-delivery drops the message rather than repeating it.
 * Returns false when the id was already claimed.
 */
export function claimNotificationEvent(db: Db, workspaceId: string, eventId: string): boolean {
  const stored = readJson(db, notificationDeliveredKey(workspaceId))
  const ids = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []
  if (ids.includes(eventId)) return false
  ids.push(eventId)
  writeJson(db, notificationDeliveredKey(workspaceId), ids.slice(-DELIVERED_RING_SIZE))
  return true
}
