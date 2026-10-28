import type { ApiErrorBody, PlatformSettings } from '@candy-mountain/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { requireAdmin } from '../auth/admin'
import type { SecretsWriter } from '../secrets'
import { parseUpdatePlatformSettings, PlatformSettingsError, readPlatformSettings, updatePlatformSettings } from './platform-settings'

export function platformSettingsRoutes(secrets: SecretsWriter) {
  const app = new Hono<AppEnv>()
  app.use(requireAdmin())
  app.onError((error, c) => {
    if (error instanceof PlatformSettingsError) return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
    throw error
  })

  app.get('/', c => c.json<PlatformSettings>(readPlatformSettings(c.var.db, secrets)))

  app.put('/', async (c) => {
    const body = await c.req.json().catch(() => {
      throw new PlatformSettingsError('invalid_request', 'Request body must be valid JSON')
    })
    return c.json<PlatformSettings>(updatePlatformSettings(c.var.db, secrets, parseUpdatePlatformSettings(body)))
  })

  return app
}
