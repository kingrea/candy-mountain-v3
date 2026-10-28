import { describe, expect, it } from 'vitest'
import { PluginTypeError } from './definition'
import { fixturePluginType } from './fixtures'
import { createPluginTypeRegistry } from './registry'
import { PLUGIN_TYPES } from './types'

describe('createPluginTypeRegistry', () => {
  it('looks types up by id in registration order', () => {
    const registry = createPluginTypeRegistry([fixturePluginType('slack'), fixturePluginType('codex')])
    expect(registry.ids()).toEqual(['slack', 'codex'])
    expect(registry.list().map(t => t.id)).toEqual(['slack', 'codex'])
    expect(registry.has('codex')).toBe(true)
    expect(registry.has('heroku')).toBe(false)
    expect(registry.byId('heroku')).toBeUndefined()
    expect(() => registry.get('heroku')).toThrow("Plugin type 'heroku' is not registered.")
    expect(Object.isFrozen(registry.list())).toBe(true)
  })

  it('rejects duplicate ids', () => {
    expect(() => createPluginTypeRegistry([fixturePluginType('codex'), fixturePluginType('slack'), fixturePluginType('codex')])).toThrow(
      new PluginTypeError("Duplicate plugin type id(s): 'codex'."),
    )
  })

  it('loads the real plugin type list', () => {
    expect(() => createPluginTypeRegistry(PLUGIN_TYPES)).not.toThrow()
  })
})
