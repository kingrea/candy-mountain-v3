// Deliberately has no way to read a value back, so it is the only shape HTTP-facing code may hold.
export interface SecretsWriter {
  readonly unlocked: boolean
  set(owner: string, name: string, value: string): void
  isSet(owner: string, name: string): boolean
  delete(owner: string, name: string): boolean
  deleteOwner(owner: string): number
}

export interface SecretsStore extends SecretsWriter {
  get(owner: string, name: string): string | undefined
  readonly writeOnly: SecretsWriter
}
