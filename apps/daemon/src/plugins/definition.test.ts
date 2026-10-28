import { describe, expect, it } from 'vitest'
import { definePluginType, PluginTypeError, type AnyPluginType } from './definition'
import { clonePluginType, fixturePluginType } from './fixtures'
import { createPluginTypeRegistry } from './registry'

const broken = (mutate: (type: ReturnType<typeof clonePluginType>) => void): AnyPluginType => {
  const type = clonePluginType(fixturePluginType('netlify'))
  mutate(type)
  return type as AnyPluginType
}

describe('definePluginType', () => {
  it('registers a sample type cleanly', () => {
    const type = fixturePluginType('netlify')
    const registry = createPluginTypeRegistry([type])
    expect(registry.ids()).toEqual(['netlify'])
    expect(registry.get('netlify')).toBe(type)
  })

  it('accepts a type supporting both scopes', () => {
    const type = broken(t => { t.scopes = ['project', 'global'] })
    expect(() => createPluginTypeRegistry([type])).not.toThrow()
  })

  it('rejects a type with no scope', () => {
    expect(() => createPluginTypeRegistry([broken(t => { t.scopes = [] })])).toThrow(new PluginTypeError("Plugin type 'netlify': needs at least one scope."))
  })

  it('rejects a type with no health check', () => {
    const type = broken(t => { delete (t as Partial<typeof t>).healthCheck })
    expect(() => createPluginTypeRegistry([type])).toThrow("Plugin type 'netlify': needs a health check.")
  })

  it('rejects the same problems at definition time', () => {
    // @ts-expect-error a health check is required
    expect(() => definePluginType({ ...fixturePluginType('slack'), healthCheck: undefined })).toThrow(PluginTypeError)
    expect(() => definePluginType({ ...fixturePluginType('slack'), scopes: [] })).toThrow('needs at least one scope')
  })

  it.each<[string, (t: ReturnType<typeof clonePluginType>) => void, string]>([
    ['unknown id', t => { t.id = 'gitlab' as never }, "Unknown plugin type id 'gitlab'"],
    ['blank name', t => { t.name = ' ' }, 'name and description must not be empty'],
    ['no reach lines', t => { t.reach = [] }, 'at least one reach line'],
    ['unknown scope', t => { t.scopes = ['organisation' as never] }, "unknown scope(s) 'organisation'"],
    ['duplicate scope', t => { t.scopes = ['project', 'project'] }, "duplicate scope(s) 'project'"],
    ['missing singleInstance', t => { t.singleInstance = undefined as never }, 'singleInstance must be true or false'],
    ['bad field name', t => { t.secretFields[0]!.name = 'api_token' }, "invalid field name(s) 'api_token'"],
    ['config and secret share a name', t => { t.secretFields[0]!.name = 'account' }, "duplicate field name(s) 'account'"],
    ['unknown field kind', t => { (t.configFields[2] as { kind: string }).kind = 'number' }, "unknown kind 'number'"],
    ['select without options', t => { (t.configFields[0] as { options: unknown[] }).options = [] }, 'needs at least one option'],
    ['select default not an option', t => { t.configFields[0]!.default = 'gamma' }, "config field 'host' has an invalid default"],
    ['invalid pattern', t => { (t.configFields[1] as { pattern: string }).pattern = '([' }, 'invalid pattern'],
    ['secret without label', t => { t.secretFields[0]!.label = '' }, "secret field 'token' needs a label"],
    ['onDelete not a function', t => { (t as { onDelete?: unknown }).onDelete = 'rm -rf' }, 'onDelete must be a function'],
  ])('rejects %s', (_, mutate, message) => {
    expect(() => createPluginTypeRegistry([broken(mutate)])).toThrow(message)
  })

  it('types the health check context from the declared fields', () => {
    definePluginType({
      id: 'heroku',
      name: 'Heroku',
      description: 'Heroku apps.',
      reach: ['Read app releases.'],
      scopes: ['project'],
      singleInstance: false,
      configFields: [
        { kind: 'string', name: 'app', label: 'App', required: true },
        { kind: 'select', name: 'region', label: 'Region', options: [{ value: 'us', label: 'US' }, { value: 'eu', label: 'EU' }], default: 'us' },
        { kind: 'string', name: 'note', label: 'Note' },
      ],
      secretFields: [{ name: 'apiKey', label: 'API key', required: true }],
      healthCheck({ config, secrets }) {
        const app: string = config.app
        const region: 'us' | 'eu' = config.region
        // @ts-expect-error optional fields may be absent
        const note: string = config.note
        // @ts-expect-error only declared secrets can be read
        secrets.get('password')
        return secrets.get('apiKey') ? { healthy: true, detail: `${app} ${region} ${note}` } : { healthy: false, reason: 'No key.' }
      },
    })
  })
})
