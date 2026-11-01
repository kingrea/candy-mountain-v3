import { MANIFEST_ID_PATTERN, type ModuleDefinition } from '@candy-mountain/shared'
import { duplicates, rungIndex, type CapabilityRegistry } from '../capabilities'

/** Thrown while registering modules, so a bad definition stops the daemon at boot. */
export class ModuleDefinitionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModuleDefinitionError'
  }
}

export interface ModuleRegistry {
  /** In registration order. */
  list(): readonly ModuleDefinition[]
  byId(id: string): ModuleDefinition | undefined
  /** Throws for an id that is not registered. */
  get(id: string): ModuleDefinition
  has(id: string): boolean
  withCapability(capabilityId: string): readonly ModuleDefinition[]
}

export function createModuleRegistry(modules: readonly ModuleDefinition[], capabilities: CapabilityRegistry): ModuleRegistry {
  assertModules(modules, capabilities)
  const list = Object.freeze([...modules])
  const byId = new Map<string, ModuleDefinition>(list.map(m => [m.id, m]))
  return {
    list: () => list,
    byId: id => byId.get(id),
    get(id) {
      const mod = byId.get(id)
      if (!mod) throw new Error(`Module '${id}' is not registered.`)
      return mod
    },
    has: id => byId.has(id),
    withCapability: capabilityId => list.filter(m => m.capabilities.some(member => member.capabilityId === capabilityId)),
  }
}

export function assertModules(modules: readonly ModuleDefinition[], capabilities: CapabilityRegistry): void {
  const dup = duplicates(modules.map(m => m.id))
  if (dup.length) throw new ModuleDefinitionError(`Duplicate module id(s): ${dup.map(id => `'${id}'`).join(', ')}.`)

  for (const mod of modules) {
    const fail = (msg: string): never => {
      throw new ModuleDefinitionError(`Module '${String(mod.id)}': ${msg}`)
    }
    if (typeof mod.id !== 'string' || !MANIFEST_ID_PATTERN.test(mod.id)) {
      throw new ModuleDefinitionError(`Invalid module id '${String(mod.id)}'; ids are lowercase letters and digits joined by '-', '_' or '.'.`)
    }
    for (const field of ['label', 'description', 'icon'] as const) {
      if (typeof mod[field] !== 'string' || mod[field].trim() === '') fail(`${field} must not be empty.`)
    }
    const members = duplicates(mod.capabilities.map(m => m.capabilityId))
    if (members.length) fail(`lists capability ${members.map(id => `'${id}'`).join(', ')} more than once.`)
    for (const { capabilityId, defaultRung } of mod.capabilities) {
      const cap = capabilities.byId(capabilityId)
      if (!cap) fail(`capability '${capabilityId}' is not registered.`)
      if (rungIndex(cap!, defaultRung) < 0) {
        fail(`default rung '${defaultRung}' is not on the ladder of capability '${capabilityId}' (${cap!.ladder.map(r => r.name).join(', ')}).`)
      }
    }
  }
}
