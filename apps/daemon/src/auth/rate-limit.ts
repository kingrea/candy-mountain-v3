import { systemClock, type SessionClock } from './sessions'

export interface LoginRateLimitOptions {
  maxFailures: number
  windowMs: number
  clock?: SessionClock
}

const SWEEP_THRESHOLD = 10_000

export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>()
  private readonly clock: SessionClock

  constructor(private readonly options: LoginRateLimitOptions) {
    this.clock = options.clock ?? systemClock
  }

  /** Seconds to wait before retrying, or 0 when every key is under its limit. */
  retryAfterSeconds(keys: string[]): number {
    const now = this.clock.now().getTime()
    let waitMs = 0
    for (const key of keys) {
      const recent = this.recent(key, now)
      if (recent.length >= this.options.maxFailures) waitMs = Math.max(waitMs, recent[0]! + this.options.windowMs - now)
    }
    return waitMs > 0 ? Math.ceil(waitMs / 1000) : 0
  }

  recordFailure(keys: string[]) {
    const now = this.clock.now().getTime()
    if (this.failures.size > SWEEP_THRESHOLD) this.sweep(now)
    for (const key of keys) this.failures.set(key, [...this.recent(key, now), now])
  }

  clear(key: string) {
    this.failures.delete(key)
  }

  private recent(key: string, now: number): number[] {
    const cutoff = now - this.options.windowMs
    const recent = (this.failures.get(key) ?? []).filter((at) => at > cutoff)
    if (recent.length) this.failures.set(key, recent)
    else this.failures.delete(key)
    return recent
  }

  private sweep(now: number) {
    for (const key of [...this.failures.keys()]) this.recent(key, now)
  }
}

export const userKey = (username: string) => `user:${username.toLowerCase()}`
export const ipKey = (ip: string) => `ip:${ip}`
