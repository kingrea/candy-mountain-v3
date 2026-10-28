import type { AnyCapabilityManifest } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { fixtureCapability } from '../capabilities/fixtures'
import { capabilityReadiness, requiredPluginTypes, type PluginReadiness, type ProjectFacts } from './readiness'

const bots: AnyCapabilityManifest = { ...fixtureCapability('bots', ['repository']), requiresAnyPlugins: [['claude-code', 'codex']] }
const facts: ProjectFacts = { hasBeads: true, isGitRepo: true, hasRemote: true, hasBots: false }
const ready = (name: string): PluginReadiness => ({ name, state: 'ready' })
const plugins = (overrides: Record<string, PluginReadiness>) => ({
  repository: ready('Repository'),
  'claude-code': { name: 'Claude Code', state: 'missing' } as PluginReadiness,
  codex: { name: 'Codex', state: 'unhealthy', reason: 'Not logged in.' } as PluginReadiness,
  ...overrides,
})

describe('capabilityReadiness with an any-of plugin group', () => {
  it('is ready when any one member of the group is ready', () => {
    expect(capabilityReadiness(bots, plugins({ 'claude-code': ready('Claude Code') }), facts)).toEqual([])
    expect(capabilityReadiness(bots, plugins({ codex: ready('Codex') }), facts)).toEqual([])
  })

  it('names every member when none is ready, by display name', () => {
    expect(capabilityReadiness(bots, plugins({}), facts)).toEqual([
      { kind: 'plugin-any', plugins: ['claude-code', 'codex'], message: 'Needs one of: Claude Code, Codex; none is configured and healthy.' },
    ])
  })

  it('treats members absent from the loaded plugins as missing, falling back to their ids', () => {
    expect(capabilityReadiness(bots, { repository: ready('Repository') }, facts)).toEqual([
      { kind: 'plugin-any', plugins: ['claude-code', 'codex'], message: 'Needs one of: claude-code, codex; none is configured and healthy.' },
    ])
  })

  it('still requires every all-of plugin alongside the group', () => {
    expect(capabilityReadiness(bots, plugins({ repository: { name: 'Repository', state: 'missing' }, codex: ready('Codex') }), facts)).toEqual([
      { kind: 'plugin', plugin: 'repository', message: 'No Repository plugin is configured for this project or the platform.' },
    ])
  })

  it('lists group members among the plugin types to load', () => {
    expect(requiredPluginTypes(bots)).toEqual(['repository', 'claude-code', 'codex'])
  })
})

describe('capabilityReadiness with the hasBots fact', () => {
  const team: AnyCapabilityManifest = { ...fixtureCapability('team'), requiresProjectFacts: ['hasBots'] }

  it('is not ready until the project has a bot', () => {
    expect(capabilityReadiness(team, {}, facts)).toEqual([{ kind: 'project-fact', fact: 'hasBots', message: 'The project has no bots yet; add one on the Bots page.' }])
    expect(capabilityReadiness(team, {}, { ...facts, hasBots: true })).toEqual([])
  })
})
