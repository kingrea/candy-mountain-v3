import type { ModuleDefinition, ModuleInfo, ModuleListResponse } from '@candy-mountain/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../app'
import type { CapabilityRegistry } from '../capabilities'

export function moduleInfo(mod: ModuleDefinition, capabilities: CapabilityRegistry): ModuleInfo {
  return {
    id: mod.id,
    label: mod.label,
    description: mod.description,
    icon: mod.icon,
    capabilities: mod.capabilities.map(({ capabilityId, defaultRung }) => {
      const cap = capabilities.get(capabilityId)
      return {
        capabilityId,
        defaultRung,
        label: cap.label,
        description: cap.description,
        requiresPlugins: cap.requiresPlugins,
        requiresAnyPlugins: cap.requiresAnyPlugins ?? [],
        requiresProjectFacts: cap.requiresProjectFacts ?? [],
      }
    }),
  }
}

// Open to every signed-in actor: definitions carry no project state or secrets.
export function moduleRoutes() {
  const app = new Hono<AppEnv>()
  app.get('/', c => c.json<ModuleListResponse>({ modules: c.var.modules.list().map(mod => moduleInfo(mod, c.var.capabilities)) }))
  return app
}
