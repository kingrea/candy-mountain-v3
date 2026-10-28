import { type CapabilityCatalogResponse } from '@candy-mountain/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import { requireAdmin } from '../auth/admin'

export function capabilityRoutes() {
  const app = new Hono<AppEnv>()
  app.use(requireAdmin())

  app.get('/', (c) => {
    const { capabilities, modules } = c.var
    return c.json<CapabilityCatalogResponse>({
      capabilities: capabilities.list().map(cap => ({
        id: cap.id,
        label: cap.label,
        moduleIds: modules.withCapability(cap.id).map(m => m.id),
        rungs: cap.ladder.map(rung => ({ name: rung.name, label: rung.label })),
      })),
      modules: modules.list().map(m => ({ id: m.id, label: m.label })),
    })
  })

  return app
}
