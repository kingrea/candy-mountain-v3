import { describe, expect, it } from 'vitest'
import { decideAuthRedirect, loginPathFor, safeRedirectTarget } from '../../app/utils/auth-redirect'

const base = { path: '/p/acme/issues', fullPath: '/p/acme/issues?tab=open', signedIn: false, strategy: null } as const

describe('decideAuthRedirect', () => {
  it('sends signed-out visitors to login with the original URL under the password strategy', () => {
    expect(decideAuthRedirect({ ...base, strategy: 'password' })).toBe(
      '/login?redirect=%2Fp%2Facme%2Fissues%3Ftab%3Dopen',
    )
  })

  it('never shows login for other strategies', () => {
    expect(decideAuthRedirect({ ...base, strategy: 'development' })).toBeNull()
    expect(decideAuthRedirect({ ...base, strategy: 'trusted-header' })).toBeNull()
    expect(decideAuthRedirect({ ...base, path: '/login', fullPath: '/login', strategy: 'development' })).toBe('/')
  })

  it('lets signed-in users through', () => {
    expect(decideAuthRedirect({ ...base, signedIn: true })).toBeNull()
  })

  it('keeps the login page reachable while signed out', () => {
    expect(decideAuthRedirect({ ...base, path: '/login', fullPath: '/login', strategy: 'password' })).toBeNull()
  })

  it('bounces signed-in users off login to the redirect target', () => {
    const login = { ...base, path: '/login', fullPath: '/login?redirect=/settings', signedIn: true }
    expect(decideAuthRedirect({ ...login, redirectQuery: '/settings' })).toBe('/settings')
    expect(decideAuthRedirect(login)).toBe('/')
  })
})

describe('safeRedirectTarget', () => {
  it('accepts same-origin paths', () => {
    expect(safeRedirectTarget('/p/a?x=1')).toBe('/p/a?x=1')
  })

  it('rejects external, protocol-relative, non-string and login targets', () => {
    for (const bad of ['https://evil.test', '//evil.test', '/\\evil', undefined, ['/a'], '/login', '/login?redirect=/x']) {
      expect(safeRedirectTarget(bad)).toBe('/')
    }
  })
})

describe('loginPathFor', () => {
  it('encodes the path', () => {
    expect(loginPathFor('/a b')).toBe('/login?redirect=%2Fa%20b')
  })
})
