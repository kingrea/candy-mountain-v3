import type { PluginInstance, PluginTypeInfo, RegistryCapability, RegistryResponse } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import {
  issuesRunAvailability,
  issuesRunPrompt,
  issuesRunRepository,
  issuesRunThreadTitle,
} from '../../app/utils/issues-run'

function capability(id: RegistryCapability['id'], overrides: Partial<RegistryCapability> = {}): RegistryCapability {
  return { id, label: id, rung: 'chat', chat: true, ready: true, reasons: [], modules: [], views: [], tools: [], ...overrides }
}

function registry(capabilities: RegistryCapability[], admin = true): RegistryResponse {
  return {
    project: { id: 'p1', slug: 'acme', name: 'Acme' },
    admin,
    modules: [],
    groups: [],
    views: [],
    agents: [
      { id: 'claude-code', capabilityId: 'chat-claude-code', label: 'Claude Code', description: '' },
      { id: 'codex', capabilityId: 'chat-codex', label: 'Codex', description: '' },
    ],
    capabilities,
    degraded: [],
  }
}

const repositoryType = {
  id: 'repository',
  name: 'Repository',
  secretFields: [{ name: 'token', label: 'Token', required: true }],
} as unknown as PluginTypeInfo

function instance(overrides: Partial<PluginInstance> = {}): PluginInstance {
  return {
    id: 'i1',
    type: 'repository',
    scope: 'project',
    projectId: 'p1',
    projectSlug: 'acme',
    config: {},
    secrets: { token: 'set' },
    health: { healthy: true, checkedAt: '2026-10-28T00:00:00Z' },
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
    ...overrides,
  }
}

const repo = (instances: PluginInstance[] | null, reg: RegistryResponse | null = registry([]), loading = false) =>
  issuesRunRepository({ registry: reg, slug: 'acme', instances, types: [repositoryType], loading })

describe('issuesRunPrompt', () => {
  it('is the fixed sentence with the id', () => {
    expect(issuesRunPrompt(['cm-1'])).toBe('Complete cm-1. Check to see if you have any skills relevant to running beads.')
  })

  it('lists every id separated by commas', () => {
    expect(issuesRunPrompt(['cm-1', 'cm-2.3', 'cm-4'])).toBe('Complete cm-1, cm-2.3, cm-4. Check to see if you have any skills relevant to running beads.')
  })
})

describe('issuesRunThreadTitle', () => {
  it('names the ids, or counts them when they would not fit', () => {
    expect(issuesRunThreadTitle(['cm-1', 'cm-2'])).toBe('Run cm-1, cm-2')
    expect(issuesRunThreadTitle(Array.from({ length: 30 }, (_, i) => `cm-${i}`))).toBe('Run 30 issues')
  })
})

describe('issuesRunRepository', () => {
  it('is ready with a healthy project or global instance', () => {
    expect(repo([instance()])).toEqual({ state: 'ready' })
    expect(repo([instance({ scope: 'global', projectId: null, projectSlug: null })])).toEqual({ state: 'ready' })
  })

  it('prefers the project instance over the global one', () => {
    const global = instance({ id: 'g', scope: 'global', projectId: null, projectSlug: null })
    const own = instance({ health: { healthy: false, reason: 'bad token', checkedAt: '2026-10-28T00:00:00Z' } })
    expect(repo([global, own])).toEqual({ state: 'missing', reason: 'The Repository plugin is unhealthy: bad token' })
  })

  it('ignores another project\'s instance', () => {
    expect(repo([instance({ projectSlug: 'other' })])).toEqual({ state: 'missing', reason: 'No Repository plugin is configured for this project or the platform.' })
  })

  it('names missing secrets and untested instances', () => {
    expect(repo([instance({ secrets: { token: 'unset' } })])).toEqual({ state: 'missing', reason: 'The Repository plugin is missing the secret \'token\'.' })
    expect(repo([instance({ health: null })])).toEqual({ state: 'missing', reason: 'The Repository plugin has not been tested since it was last changed; run its connection test.' })
  })

  it('falls back to the bots capability when the instance list is unreadable', () => {
    expect(repo(null, registry([capability('bots')], false))).toEqual({ state: 'ready' })
    const reason = { kind: 'plugin' as const, plugin: 'repository', message: 'No Repository plugin is configured for this project or the platform.' }
    expect(repo(null, registry([capability('bots', { ready: false, reasons: [reason] })]))).toEqual({ state: 'missing', reason: reason.message })
    expect(repo(null, registry([], false))).toEqual({ state: 'missing', reason: 'Run needs a healthy Repository plugin for this project; ask an admin to check it.' })
    expect(repo(null, registry([]), true)).toEqual({ state: 'checking' })
  })
})

describe('issuesRunAvailability', () => {
  it('is enabled with the repository and one ready agent', () => {
    const availability = issuesRunAvailability(registry([capability('chat-claude-code')]), { state: 'ready' })
    expect(availability.enabled).toBe(true)
    expect(availability.missing).toEqual([])
    expect(availability.agents.map(agent => [agent.agentId, agent.name])).toEqual([['claude-code', 'Claude Code']])
  })

  it('offers both agents when both are ready', () => {
    const availability = issuesRunAvailability(registry([capability('chat-claude-code'), capability('chat-codex')]), { state: 'ready' })
    expect(availability.agents.map(agent => agent.agentId)).toEqual(['claude-code', 'codex'])
  })

  it('names the missing repository', () => {
    const availability = issuesRunAvailability(registry([capability('chat-claude-code')]), { state: 'missing', reason: 'No Repository plugin is configured for this project or the platform.' })
    expect(availability).toMatchObject({ enabled: false, missing: ['No Repository plugin is configured for this project or the platform.'] })
  })

  it('names each agent\'s readiness reasons when none is ready', () => {
    const claude = capability('chat-claude-code', {
      label: 'Chat with Claude Code',
      ready: false,
      reasons: [{ kind: 'plugin', plugin: 'claude-code', message: 'No Claude Code plugin is configured for this project or the platform.' }],
    })
    const codex = capability('chat-codex', { label: 'Chat with Codex', ready: false })
    expect(issuesRunAvailability(registry([claude, codex]), { state: 'ready' })).toMatchObject({
      enabled: false,
      agents: [],
      missing: [
        'Run needs Claude Code or Codex ready for this project.',
        'No Claude Code plugin is configured for this project or the platform.',
        'Chat with Codex is not ready for this project.',
      ],
    })
  })

  it('says when the rung does not allow chat', () => {
    const availability = issuesRunAvailability(registry([capability('chat-codex', { label: 'Chat with Codex', chat: false })]), { state: 'checking' })
    expect(availability.missing).toEqual([
      'Checking the Repository plugin…',
      'Run needs Claude Code or Codex ready for this project.',
      'Your access does not include Chat with Codex.',
    ])
  })
})
