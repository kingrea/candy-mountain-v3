import { describe, expect, it } from 'vitest'
import { pluginTypeInfo, validatePluginConfig, type PluginConfigField, type PluginTypeInfo } from './plugins'

const fields: readonly PluginConfigField[] = [
  { kind: 'select', name: 'host', label: 'Host', options: [{ value: 'github', label: 'GitHub' }, { value: 'bitbucket', label: 'Bitbucket' }], required: true },
  { kind: 'string', name: 'owner', label: 'Owner', required: true, pattern: '[A-Za-z0-9-]+' },
  { kind: 'string', name: 'branch', label: 'Default branch', default: 'main' },
  { kind: 'boolean', name: 'archived', label: 'Archived' },
]

describe('validatePluginConfig', () => {
  it('accepts valid input, trims strings and fills defaults', () => {
    expect(validatePluginConfig(fields, { host: 'github', owner: ' jack ' })).toEqual({ ok: true, config: { host: 'github', owner: 'jack', branch: 'main' } })
    expect(validatePluginConfig(fields, { host: 'bitbucket', owner: 'jack', branch: 'dev', archived: false })).toEqual({
      ok: true,
      config: { host: 'bitbucket', owner: 'jack', branch: 'dev', archived: false },
    })
  })

  it('reports each problem by field', () => {
    expect(validatePluginConfig(fields, { host: 'gitlab', owner: 'a b', archived: 'yes', extra: 1 })).toEqual({
      ok: false,
      errors: [
        { field: 'extra', message: 'Unknown field.' },
        { field: 'host', message: 'Host must be one of github, bitbucket.' },
        { field: 'owner', message: 'Owner is not in the expected format.' },
        { field: 'archived', message: 'Archived must be true or false.' },
      ],
    })
  })

  it('requires required fields and treats blank as missing', () => {
    expect(validatePluginConfig(fields, { host: 'github', owner: '  ' })).toEqual({ ok: false, errors: [{ field: 'owner', message: 'Owner is required.' }] })
  })

  it('anchors patterns to the whole value', () => {
    const anchored: PluginConfigField[] = [{ kind: 'string', name: 'id', label: 'Id', pattern: 'a|b' }]
    expect(validatePluginConfig(anchored, { id: 'ab' }).ok).toBe(false)
    expect(validatePluginConfig(anchored, { id: 'b' }).ok).toBe(true)
  })

  it('rejects a non-object', () => {
    expect(validatePluginConfig(fields, ['x'])).toEqual({ ok: false, errors: [{ field: '', message: 'Config must be an object.' }] })
  })
})

describe('plugin type helpers', () => {
  it('strips the health check for the wire', () => {
    const type: PluginTypeInfo & { healthCheck: () => unknown } = {
      id: 'slack',
      name: 'Slack',
      description: 'Slack.',
      reach: ['Post messages.'],
      scopes: ['global'],
      singleInstance: true,
      configFields: [],
      secretFields: [{ name: 'botToken', label: 'Bot token' }],
      healthCheck: () => ({ healthy: true }),
    }
    const info = pluginTypeInfo(type)
    expect(info).not.toHaveProperty('healthCheck')
    expect(JSON.parse(JSON.stringify(info))).toEqual(info)
  })
})
