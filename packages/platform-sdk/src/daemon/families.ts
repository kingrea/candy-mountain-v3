export interface SessionFamily {
  id: string
  /** Shown in activity titles and errors, e.g. 'Claude Code'. */
  name: string
}

export interface SessionFamilyRegistry {
  /** In registration order. */
  list(): readonly SessionFamily[]
  ids(): readonly string[]
  has(id: string): boolean
  /** The family's name, or the id itself for a family that is not registered. */
  nameOf(id: string): string
}
