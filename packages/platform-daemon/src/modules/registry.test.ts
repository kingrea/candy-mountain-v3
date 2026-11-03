import { existsSync } from 'node:fs'
import type { ModuleDefinition } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { createCapabilityRegistry } from '../capabilities'
import { fixtureCapability } from '../capabilities/fixtures'
import { createTempDataDir, startTestPlatform, type TempDataDir } from '../testing'
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

  it('rejects malformed, duplicate and incomplete modules', () => {
    rejects([mod({ id: 'Billing' })], "Invalid module id 'Billing'")
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
    expect(() => startTestPlatform(temp.root, { capabilities: [fixtureCapability('uptime')], modules: [mod({ capabilities: [{ capabilityId: 'uptime', defaultRung: 'admin' }] })] }))
      .toThrow("Module 'operations': default rung 'admin' is not on the ladder of capability 'uptime' (none, read, full).")
    expect(existsSync(temp.root)).toBe(false)
  })
})
