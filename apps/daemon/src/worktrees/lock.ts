export type KeyedLock = <T>(key: string, fn: () => Promise<T>) => Promise<T>

/** Runs callers with the same key one after another, in call order; different keys do not wait for each other. */
export function createKeyedLock(): KeyedLock {
  const tails = new Map<string, Promise<void>>()
  return async (key, fn) => {
    const previous = tails.get(key) ?? Promise.resolve()
    let done!: () => void
    const current = new Promise<void>((resolve) => { done = resolve })
    const tail = previous.then(() => current)
    tails.set(key, tail)
    await previous
    try {
      return await fn()
    }
    finally {
      done()
      if (tails.get(key) === tail) tails.delete(key)
    }
  }
}
