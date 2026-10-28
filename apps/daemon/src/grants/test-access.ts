import { randomUUID } from 'node:crypto'
import type { AnyCapabilityManifest, ModuleDefinition } from '@candy-mountain/shared'
import { createCapabilityRegistry } from '../capabilities'
import { fixtureCapability } from '../capabilities/fixtures'
import type { Db } from '../db'
import { roles } from '../db/schema'
import { createModuleRegistry } from '../modules'
import type { AccessDeps } from './access'

/** Every fixture ladder is none, read, full. */
export const TEST_CAPABILITIES: readonly AnyCapabilityManifest[] = ['issues', 'uptime', 'deployments', 'team'].map(id => fixtureCapability(id as never))

/** 'uptime' sits in two modules with different default rungs. */
export const TEST_MODULES: readonly ModuleDefinition[] = [
  { id: 'issues', label: 'Issues', description: 'Issues.', icon: 'i-lucide-list-todo', capabilities: [{ capabilityId: 'issues', defaultRung: 'read' }, { capabilityId: 'uptime', defaultRung: 'full' }] },
  { id: 'agent-hub', label: 'Agent Hub', description: 'Agents.', icon: 'i-lucide-bot', capabilities: [] },
  { id: 'operations', label: 'Operations', description: 'Ops.', icon: 'i-lucide-activity', capabilities: [{ capabilityId: 'uptime', defaultRung: 'read' }, { capabilityId: 'deployments', defaultRung: 'none' }] },
]

export function testAccess(db: Db): AccessDeps {
  const capabilities = createCapabilityRegistry(TEST_CAPABILITIES)
  return { db, capabilities, modules: createModuleRegistry(TEST_MODULES, capabilities) }
}

export function addRole(db: Db, slug: string): void {
  const now = new Date().toISOString()
  db.insert(roles).values({ id: randomUUID(), slug, name: slug, createdAt: now, updatedAt: now }).run()
}
