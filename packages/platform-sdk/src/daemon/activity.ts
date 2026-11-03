import type { ActivityEvent, ActivityEventTypeInfo, NotificationKindInfo } from '../index'

/** A kind of notification a rule can be saved for, raised by events of the type that declares it. */
export interface NotificationKindDeclaration {
  id: string
  /** What the rules page shows, e.g. 'A bot finishes'. */
  label: string
  /** For a type that raises more than one kind; absent means every event of the type raises this one. */
  matches?(payload: Record<string, unknown> | null): boolean
}

/** An event type a capability emits, declared on its definition. */
export interface ActivityEventTypeDeclaration {
  id: string
  /** What the activity filters show, e.g. 'Incident opened'. */
  label: string
  /** An Iconify name; the web uses its fallback icon when absent. */
  icon?: string
  notifications?: readonly NotificationKindDeclaration[]
}

export interface ActivityEventTypeRegistry {
  /** In registration order. */
  list(): readonly string[]
  has(type: string): boolean
  /** In registration order, as the web reads them. */
  info(): readonly ActivityEventTypeInfo[]
  /** In registration order. */
  notificationKinds(): readonly NotificationKindInfo[]
  hasNotificationKind(kind: string): boolean
  /** The first declared kind the event raises, or null. */
  notificationKindOf(event: Pick<ActivityEvent, 'type' | 'payload'>): string | null
}
