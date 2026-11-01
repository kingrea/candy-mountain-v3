import { PLATFORM_SETTINGS_PATH, type Actor } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, startTestPlatform } from '../testing/platform'
import type { AuthStrategy } from '../auth'
import type { Platform } from '../platform'
import { MasterKey } from '../secrets'
import { createTempDataDir, type TempDataDir } from '../testing'
import { LLM_GATEWAY_SECRET_NAME, LLM_GATEWAY_SECRET_OWNER, resolveLlmGatewayConfig } from './platform-settings'

let dir: TempDataDir
let platform: Platform
beforeEach(() => {
  dir = createTempDataDir()
  platform = startTestPlatform(dir.root, { secretsKey: MasterKey.generate() })
})
afterEach(() => {
  platform.close()
  dir.cleanup()
})

const as = (roles: string[]): AuthStrategy => ({
  name: 'development',
  resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }),
})

const app = (roles = ['admin'], secrets = platform.secrets.writeOnly) =>
  createTestApp({ db: platform.db, paths: platform.paths, auth: as(roles), secrets })

const put = (body: unknown, roles?: string[]) =>
  app(roles).request(PLATFORM_SETTINGS_PATH, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('platform settings', () => {
  it('reports everything unset on a fresh daemon', async () => {
    const res = await app().request(PLATFORM_SETTINGS_PATH)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ gatewayBaseUrl: null, modelId: null, gatewayKeySet: false, secretsUnlocked: true })
    expect(resolveLlmGatewayConfig(platform.db, platform.secrets)).toEqual({ baseUrl: null, modelId: null, apiKey: undefined })
  })

  it('saves a key as set without ever returning it, and persists the model id', async () => {
    const res = await put({ gatewayKey: 'sk-secret-123', modelId: 'claude-sonnet-5-5', gatewayBaseUrl: 'https://gateway.example.com/v1' })
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).not.toContain('sk-secret-123')
    expect(JSON.parse(text)).toEqual({ gatewayBaseUrl: 'https://gateway.example.com/v1', modelId: 'claude-sonnet-5-5', gatewayKeySet: true, secretsUnlocked: true })

    const again = await app().request(PLATFORM_SETTINGS_PATH)
    expect(await again.text()).not.toContain('sk-secret-123')
    expect(resolveLlmGatewayConfig(platform.db, platform.secrets)).toEqual({ baseUrl: 'https://gateway.example.com/v1', modelId: 'claude-sonnet-5-5', apiKey: 'sk-secret-123' })
    expect(platform.secrets.isSet(LLM_GATEWAY_SECRET_OWNER, LLM_GATEWAY_SECRET_NAME)).toBe(true)
  })

  it('leaves omitted fields alone and clears with null or blank', async () => {
    await put({ gatewayKey: 'k', modelId: 'm' })
    expect(await (await put({ modelId: 'm2' })).json()).toMatchObject({ modelId: 'm2', gatewayKeySet: true })
    expect(await (await put({ gatewayKey: null, modelId: '  ' })).json()).toMatchObject({ modelId: null, gatewayKeySet: false })
  })

  it('rejects non-admins, bad bodies and bad urls', async () => {
    expect((await put({ modelId: 'm' }, ['developer'])).status).toBe(403)
    expect((await app(['developer']).request(PLATFORM_SETTINGS_PATH)).status).toBe(403)
    expect((await put({ gatewayBaseUrl: 'ftp://x' })).status).toBe(400)
    expect((await put({ modelId: 5 })).status).toBe(400)
    expect((await put([])).status).toBe(400)
    const bad = await app().request(PLATFORM_SETTINGS_PATH, { method: 'PUT', body: '{nope' })
    expect(bad.status).toBe(400)
  })

  it('works with the secrets store locked', async () => {
    const locked = startTestPlatform(dir.root + '-locked')
    try {
      const res = await app(['admin'], locked.secrets.writeOnly).request(PLATFORM_SETTINGS_PATH)
      expect(await res.json()).toEqual({ gatewayBaseUrl: null, modelId: null, gatewayKeySet: false, secretsUnlocked: false })
      const save = await app(['admin'], locked.secrets.writeOnly).request(PLATFORM_SETTINGS_PATH, { method: 'PUT', body: JSON.stringify({ gatewayKey: 'k' }) })
      expect(save.status).toBe(409)
      expect(((await save.json()) as { error: { code: string } }).error.code).toBe('secrets_locked')
    } finally {
      locked.close()
    }
  })

  it('boots without the route when secrets are not wired', async () => {
    const res = await createTestApp({ db: platform.db, paths: platform.paths }).request(PLATFORM_SETTINGS_PATH)
    expect(res.status).toBe(404)
  })
})

