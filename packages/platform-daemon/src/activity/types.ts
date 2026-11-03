import { MANIFEST_ID_PATTERN } from '@candy-mountain/platform-sdk'
import type { ActivityEventTypeDeclaration, ActivityEventTypeRegistry, CapabilityDefinition, NotificationKindDeclaration } from '@candy-mountain/platform-sdk/daemon'
import { duplicates } from '../capabilities/manifest'
import type { Db } from '../db'

/** Thrown while registering activity event types, or when an event names a type that is not registered. */
export class ActivityEventTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActivityEventTypeError'
  }
}

export type { ActivityEventTypeDeclaration, ActivityEventTypeRegistry, NotificationKindDeclaration }

const isId = (value: unknown): value is string => typeof value === 'string' && MANIFEST_ID_PATTERN.test(value)
const isLabel = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const quoted = (values: readonly unknown[]) => values.map(v => `'${String(v)}'`).join(', ')

export function createActivityEventTypeRegistry(declarations: readonly ActivityEventTypeDeclaration[]): ActivityEventTypeRegistry {
  const types = declarations.map(d => d?.id)
  const bad = types.filter(type => !isId(type))
  if (bad.length) throw new ActivityEventTypeError(`Invalid activity event type(s) ${quoted(bad)}; types are lowercase letters and digits joined by '-', '_' or '.'.`)
  const dup = duplicates(types)
  if (dup.length) throw new ActivityEventTypeError(`Duplicate activity event type(s): ${quoted(dup)}.`)
  const unlabelled = declarations.filter(d => !isLabel(d.label))
  if (unlabelled.length) throw new ActivityEventTypeError(`Activity event type(s) ${quoted(unlabelled.map(d => d.id))} need a label.`)
  const badIcons = declarations.filter(d => d.icon !== undefined && !isLabel(d.icon))
  if (badIcons.length) throw new ActivityEventTypeError(`Activity event type(s) ${quoted(badIcons.map(d => d.id))} have an empty icon.`)

  const kinds = declarations.flatMap(d => (d.notifications ?? []).map(kind => ({ type: d.id, kind })))
  const badKinds = kinds.filter(({ kind }) => !isId(kind?.id))
  if (badKinds.length) throw new ActivityEventTypeError(`Invalid notification kind(s) ${quoted(badKinds.map(({ kind }) => kind?.id))}; kinds are lowercase letters and digits joined by '-', '_' or '.'.`)
  const dupKinds = duplicates(kinds.map(({ kind }) => kind.id))
  if (dupKinds.length) throw new ActivityEventTypeError(`Duplicate notification kind(s): ${quoted(dupKinds)}.`)
  const unlabelledKinds = kinds.filter(({ kind }) => !isLabel(kind.label))
  if (unlabelledKinds.length) throw new ActivityEventTypeError(`Notification kind(s) ${quoted(unlabelledKinds.map(({ kind }) => kind.id))} need a label.`)
  const badMatches = kinds.filter(({ kind }) => kind.matches !== undefined && typeof kind.matches !== 'function')
  if (badMatches.length) throw new ActivityEventTypeError(`Notification kind(s) ${quoted(badMatches.map(({ kind }) => kind.id))}: matches must be a function.`)

  const list = Object.freeze([...types])
  const known = new Set(list)
  const info = Object.freeze(declarations.map(d => Object.freeze({ id: d.id, label: d.label, icon: d.icon ?? null })))
  const kindInfo = Object.freeze(kinds.map(({ kind }) => Object.freeze({ id: kind.id, label: kind.label })))
  const knownKinds = new Set(kindInfo.map(k => k.id))
  const kindsByType = new Map(declarations.map(d => [d.id, d.notifications ?? []]))
  return {
    list: () => list,
    has: type => known.has(type),
    info: () => info,
    notificationKinds: () => kindInfo,
    hasNotificationKind: kind => knownKinds.has(kind),
    notificationKindOf: event => (kindsByType.get(event.type) ?? []).find(kind => !kind.matches || kind.matches(event.payload ?? null))?.id ?? null,
  }
}

/** Every type the definitions declare, in definition order. */
export const declaredActivityEventTypes = (definitions: readonly CapabilityDefinition[]): ActivityEventTypeDeclaration[] =>
  definitions.flatMap(d => d.activityEventTypes ?? [])

const noTypes = createActivityEventTypeRegistry([])
const registered = new WeakMap<Db, ActivityEventTypeRegistry>()

/** Keyed by database, like append listeners, so emitters deep in services need nothing but the db they already hold. */
export function registerActivityEventTypes(db: Db, types: ActivityEventTypeRegistry): void {
  registered.set(db, types)
}

/** A database the platform did not open has nothing registered, so every append on it is refused. */
export const activityEventTypesFor = (db: Db): ActivityEventTypeRegistry => registered.get(db) ?? noTypes
