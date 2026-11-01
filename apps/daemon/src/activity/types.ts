import { MANIFEST_ID_PATTERN } from '@candy-mountain/shared'
import { duplicates } from '../capabilities/manifest'
import type { Db } from '../db'

/** Thrown while registering activity event types, or when an event names a type that is not registered. */
export class ActivityEventTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActivityEventTypeError'
  }
}

/** The types the daemon emits today. */
export const ACTIVITY_EVENT_TYPES: readonly string[] = [
  'session.started',
  'run.started',
  'bot.handoff',
  'incident.opened',
  'incident.closed',
  'deploy.attempted',
]

export interface ActivityEventTypeRegistry {
  /** In registration order. */
  list(): readonly string[]
  has(type: string): boolean
}

export function createActivityEventTypeRegistry(types: readonly string[]): ActivityEventTypeRegistry {
  const bad = types.filter(type => typeof type !== 'string' || !MANIFEST_ID_PATTERN.test(type))
  if (bad.length) throw new ActivityEventTypeError(`Invalid activity event type(s) ${bad.map(t => `'${String(t)}'`).join(', ')}; types are lowercase letters and digits joined by '-', '_' or '.'.`)
  const dup = duplicates(types)
  if (dup.length) throw new ActivityEventTypeError(`Duplicate activity event type(s): ${dup.map(t => `'${t}'`).join(', ')}.`)

  const list = Object.freeze([...types])
  const known = new Set(list)
  return { list: () => list, has: type => known.has(type) }
}

const defaultTypes = createActivityEventTypeRegistry(ACTIVITY_EVENT_TYPES)
const registered = new WeakMap<Db, ActivityEventTypeRegistry>()

/** Keyed by database, like append listeners, so emitters deep in services need nothing but the db they already hold. */
export function registerActivityEventTypes(db: Db, types: ActivityEventTypeRegistry): void {
  registered.set(db, types)
}

/** The daemon's own types for a database the platform did not open (tests on a bare database). */
export const activityEventTypesFor = (db: Db): ActivityEventTypeRegistry => registered.get(db) ?? defaultTypes
