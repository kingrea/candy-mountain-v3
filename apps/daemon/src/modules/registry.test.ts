import { existsSync } from 'node:fs'
import type { ModuleDefinition } from '@candy-mountain/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { CAPABILITIES, createCapabilityRegistry } from '../capabilities'
import { fixtureCapability } from '../capabilities/fixtures'
import { startPlatform } from '../platform'
import { createTempDataDir, type TempDataDir } from '../testing'
import { MODULES } from './definitions'
import { createModuleRegistry, ModuleDefinitionError } from './registry'

const capabilities = createCapabilityRegistry([fixtureCapability('uptime'), fixtureCapability('deployments')])
const mod = (overrides: Partial<ModuleDefinition> = {}): ModuleDefinition => ({
  id: 'operations',
  label: 'Operations',
  description: 'Ops.',
  icon: 'i-lucide-activity',
  capabilities: [{ capabilityId: 'uptime', defaultRung: 'read' }],
  ...overrides,
})
const rejects = (modules: ModuleDefinition[], message: string) => {
  expect(() => createModuleRegistry(modules, capabilities)).toThrow(ModuleDefinitionError)
  expect(() => createModuleRegistry(modules, capabilities)).toThrow(message)
}

describe('createModuleRegistry', () => {
  it('loads the three declared modules, empty ones included', () => {
    const registry = createModuleRegistry(MODULES, createCapabilityRegistry(CAPABILITIES))
    expect(registry.list().map(m => m.id)).toEqual(['issues', 'agent-hub', 'operations'])
    expect(registry.get('agent-hub').label).toBe('Agent Hub')
    expect(registry.get('agent-hub').capabilities).toEqual(expect.arrayContaining([{ capabilityId: 'bots', defaultRung: 'manage' }, { capabilityId: 'team', defaultRung: 'manage' }]))
    expect(registry.withCapability('bots').map(m => m.id)).toEqual(['agent-hub'])
    expect(registry.withCapability('team').map(m => m.id)).toEqual(['agent-hub'])
    expect(registry.withCapability('deployments').map(m => m.id)).toEqual(['operations'])
    expect(registry.withCapability('uptime').map(m => m.id)).toEqual(['operations'])
    expect(registry.byId('billing')).toBeUndefined()
    expect(() => registry.get('billing')).toThrow("Module 'billing' is not registered.")
  })

  it('lets a capability sit in several modules', () => {
    const registry = createModuleRegistry([
      mod({ id: 'issues', capabilities: [{ capabilityId: 'uptime', defaultRung: 'read' }] }),
      mod({ capabilities: [{ capabilityId: 'uptime', defaultRung: 'full' }, { capabilityId: 'deployments', defaultRung: 'none' }] }),
    ], capabilities)
    expect(registry.withCapability('uptime').map(m => m.id)).toEqual(['issues', 'operations'])
    expect(registry.withCapability('deployments').map(m => m.id)).toEqual(['operations'])
  })

  it('rejects a member capability that is not registered', () => {
    rejects([mod({ capabilities: [{ capabilityId: 'team', defaultRung: 'read' }] })], "Module 'operations': capability 'team' is not registered.")
  })

  it('rejects a default rung that is not on the ladder', () => {
    rejects([mod({ capabilities: [{ capabilityId: 'uptime', defaultRung: 'admin' }] })], "default rung 'admin' is not on the ladder of capability 'uptime' (none, read, full).")
  })

  it('rejects unknown, duplicate and incomplete modules', () => {
    rejects([mod({ id: 'billing' as never })], "Unknown module id 'billing'")
    rejects([mod(), mod()], "Duplicate module id(s): 'operations'.")
    rejects([mod({ label: ' ' })], "Module 'operations': label must not be empty.")
    rejects([mod({ capabilities: [{ capabilityId: 'uptime', defaultRung: 'read' }, { capabilityId: 'uptime', defaultRung: 'full' }] })], "lists capability 'uptime' more than once.")
  })
})

describe('daemon boot with modules', () => {
  let temp: TempDataDir
  afterEach(() => temp?.cleanup())

  it('refuses to start on a bad module and touches nothing on disk', () => {
    temp = createTempDataDir()
    expect(() => startPlatform(temp.root, { modules: [mod({ capabilities: [{ capabilityId: 'uptime', defaultRung: 'full' }] })] }))
      .toThrow("Module 'operations': default rung 'full' is not on the ladder of capability 'uptime' (none, read, manage).")
    expect(existsSync(temp.root)).toBe(false)
  })

  it('exposes the module registry', () => {
    temp = createTempDataDir()
    const platform = startPlatform(temp.root)
    try {
      expect(platform.modules.list().map(m => m.id)).toEqual(['issues', 'agent-hub', 'operations'])
    }
    finally {
      platform.close()
    }
  })
})
