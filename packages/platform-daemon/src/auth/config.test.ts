import { describe, expect, it } from 'vitest'
import { resolveAuthConfig } from './config'

describe('resolveAuthConfig', () => {
  it('defaults to the development strategy', () => {
    expect(resolveAuthConfig({})).toEqual({ strategy: 'development' })
  })

  it('reads the trusted-header strategy and its header name', () => {
    expect(resolveAuthConfig({ CM_AUTH_STRATEGY: 'trusted-header', CM_AUTH_TRUSTED_HEADER: ' X-Forwarded-User ' }))
      .toEqual({ strategy: 'trusted-header', header: 'x-forwarded-user' })
  })

  it('rejects unknown strategies and a missing or invalid header name', () => {
    expect(() => resolveAuthConfig({ CM_AUTH_STRATEGY: 'none' })).toThrow(/CM_AUTH_STRATEGY/)
    expect(() => resolveAuthConfig({ CM_AUTH_STRATEGY: 'trusted-header' })).toThrow(/CM_AUTH_TRUSTED_HEADER is required/)
    expect(() => resolveAuthConfig({ CM_AUTH_STRATEGY: 'trusted-header', CM_AUTH_TRUSTED_HEADER: 'bad header' }))
      .toThrow(/not a valid header name/)
  })
})

describe('resolveAuthConfig for the password strategy', () => {
  it('defaults to 30-day sessions and non-Secure cookies', () => {
    expect(resolveAuthConfig({ CM_AUTH_STRATEGY: 'password' }))
      .toEqual({ strategy: 'password', sessionTtlMs: 30 * 86_400_000, secureCookie: false, loginRateLimit: { maxFailures: 10, windowMs: 60_000 } })
  })

  it('reads the session lifetime and cookie security', () => {
    expect(resolveAuthConfig({ CM_AUTH_STRATEGY: 'password', CM_AUTH_SESSION_TTL: '12h', CM_AUTH_COOKIE_SECURE: 'true' }))
      .toEqual({ strategy: 'password', sessionTtlMs: 12 * 3_600_000, secureCookie: true, loginRateLimit: { maxFailures: 10, windowMs: 60_000 } })
    expect(resolveAuthConfig({ CM_AUTH_STRATEGY: 'password', CM_AUTH_SESSION_TTL: '90s' }))
      .toMatchObject({ sessionTtlMs: 90_000 })
  })

  it('rejects invalid lifetimes and cookie flags', () => {
    for (const ttl of ['0d', '30', '1w', '401d', '-1h']) {
      expect(() => resolveAuthConfig({ CM_AUTH_STRATEGY: 'password', CM_AUTH_SESSION_TTL: ttl })).toThrow(/CM_AUTH_SESSION_TTL/)
    }
    expect(() => resolveAuthConfig({ CM_AUTH_STRATEGY: 'password', CM_AUTH_COOKIE_SECURE: 'yes' })).toThrow(/CM_AUTH_COOKIE_SECURE/)
  })
})

describe('login rate limit config', () => {
  const base = { CM_AUTH_STRATEGY: 'password' }

  it('reads the failure count and window', () => {
    expect(resolveAuthConfig({ ...base, CM_AUTH_LOGIN_MAX_FAILURES: '3', CM_AUTH_LOGIN_WINDOW: '5m' })).toMatchObject({
      loginRateLimit: { maxFailures: 3, windowMs: 300_000 },
    })
  })

  it('rejects a non-positive count', () => {
    expect(() => resolveAuthConfig({ ...base, CM_AUTH_LOGIN_MAX_FAILURES: '0' })).toThrow(/CM_AUTH_LOGIN_MAX_FAILURES/)
  })
})
