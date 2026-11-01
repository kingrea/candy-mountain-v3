import { describe, expect, it } from 'vitest'
import { cloneManifest, fixtureCapability } from './fixtures'
import { CapabilityManifestError } from './manifest'
import { platformDefinitions } from '../platform-capabilities'
import { PLUGIN_TYPES } from '../plugins'
import { createCapabilityRegistry } from './registry'
import { CAPABILITY_DEFINITIONS } from '../testing/platform'

describe('createCapabilityRegistry', () => {
  it('loads valid manifests and looks them up', () => {
    const overview = fixtureCapability('overview')
    const issues = fixtureCapability('issues')
    const registry = createCapabilityRegistry([overview, issues])

    expect(registry.list()).toEqual([overview, issues])
    expect(registry.byId('issues')).toBe(issues)
    expect(registry.byId('uptime')).toBeUndefined()
    expect(registry.get('overview')).toBe(overview)
    expect(() => registry.get('uptime')).toThrow("Capability 'uptime' is not registered.")
    expect(registry.has('issues')).toBe(true)
  })

  it('loads the real definition list', () => {
    const registry = createCapabilityRegistry([...platformDefinitions(), ...CAPABILITY_DEFINITIONS], { pluginTypeIds: PLUGIN_TYPES.map(t => t.id) })
    expect(registry.get('bots')).toMatchObject({ views: [{ id: 'bots', path: 'bots' }], requiresPlugins: ['repository'], requiresAnyPlugins: [['claude-code', 'codex']] })
    expect(registry.get('team')).toMatchObject({ views: [{ id: 'team', path: 'team' }], requiresPlugins: [], requiresProjectFacts: ['hasBots'] })
    for (const id of ['bots', 'team']) expect(registry.get(id).ladder.map(r => r.name)).toEqual(['none', 'manage'])
    expect(registry.get('deployments')).toMatchObject({ views: [{ id: 'deployments', path: 'deployments' }], requiresPlugins: ['repository'] })
    expect(registry.get('deployments').ladder.map(r => r.name)).toEqual(['none', 'read', 'manage'])
    expect(registry.get('uptime')).toMatchObject({ views: [{ id: 'uptime', path: 'uptime' }], requiresPlugins: [], tools: [{ id: 'uptime.manage' }] })
    expect(registry.get('uptime').ladder.map(r => r.name)).toEqual(['none', 'read', 'manage'])
  })

  it('checks any-of plugin types against the known plugin types', () => {
    const cap = { ...fixtureCapability('bots'), requiresAnyPlugins: [['claude-code', 'codex']] as const }
    expect(() => createCapabilityRegistry([cap], { pluginTypeIds: ['claude-code'] })).toThrow("Capability 'bots' requires unknown plugin type 'codex'.")
  })

  it('rejects duplicate capability ids', () => {
    expect(() => createCapabilityRegistry([fixtureCapability('issues'), fixtureCapability('issues')])).toThrow(
      new CapabilityManifestError("Duplicate capability id(s) across capabilities: 'issues' (issues)."),
    )
  })

  it.each([
    ['agent id', (c: ReturnType<typeof cloneManifest>) => (c.agents[0]!.id = 'overview-agent'), "'overview-agent' (overview, issues)"],
    ['tool id', (c: ReturnType<typeof cloneManifest>) => c.tools.push({ id: 'overview.read', kind: 'tool' }), "'overview.read' (overview, issues)"],
    ['job id', (c: ReturnType<typeof cloneManifest>) => (c.jobs[0]!.id = 'overview-job'), "'overview-job' (overview, issues)"],
    ['view id', (c: ReturnType<typeof cloneManifest>) => (c.views[1]!.id = 'overview-admin', c.ladder[2]!.views = ['issues-home', 'overview-admin']), "'overview-admin' (overview, issues)"],
    ['view path', (c: ReturnType<typeof cloneManifest>) => (c.views[0]!.path = 'overview'), "'overview' (overview, issues)"],
  ])('rejects a duplicate %s across capabilities', (what, mutate, detail) => {
    const issues = cloneManifest(fixtureCapability('issues'))
    mutate(issues)
    expect(() => createCapabilityRegistry([fixtureCapability('overview'), issues])).toThrow(`Duplicate ${what}(s) across capabilities: ${detail}.`)
  })

  it('re-validates each manifest, since not every manifest comes through defineCapability', () => {
    const broken = cloneManifest(fixtureCapability('bots'))
    broken.ladder.shift()
    expect(() => createCapabilityRegistry([broken])).toThrow("Capability 'bots': the ladder must start with a rung named 'none'.")
  })

  it('checks required plugins only when plugin type ids are known', () => {
    const cap = fixtureCapability('deployments', ['repository', 'netlify'])
    expect(() => createCapabilityRegistry([cap])).not.toThrow()
    expect(() => createCapabilityRegistry([cap], { pluginTypeIds: ['repository', 'netlify'] })).not.toThrow()
    expect(() => createCapabilityRegistry([cap], { pluginTypeIds: ['repository'] })).toThrow(
      "Capability 'deployments' requires unknown plugin type 'netlify'.",
    )
  })
})
