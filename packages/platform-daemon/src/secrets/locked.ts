import { SecretsLockedError, type SecretsStore } from './store'

/** Behaves like a store without CM_SECRETS_KEY and with nothing saved; the default for apps built without one. */
export function lockedSecretsStore(): SecretsStore {
  const writeOnly = Object.freeze({
    unlocked: false,
    set(): void {
      throw new SecretsLockedError()
    },
    isSet: () => false,
    delete: () => false,
    deleteOwner: () => 0,
  })
  return Object.freeze({
    ...writeOnly,
    get(): string | undefined {
      throw new SecretsLockedError()
    },
    writeOnly,
  })
}
