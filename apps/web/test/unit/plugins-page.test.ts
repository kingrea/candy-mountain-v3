import type { PluginInstance, PluginTypeInfo, RegistryResponse } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { PLUGIN_ICON_FALLBACK, pluginIconFor, pluginPanelFor, registerPluginIcon, registerPluginPanel } from '../../app/utils/plugin-panels'
import {
  availablePluginScopes,
  PLUGIN_SELECT_NONE,
  pluginConfigDraft,
  pluginConfigErrors,
  pluginConfigPayload,
  pluginConfigSummary,
  pluginSecretDrafts,
  pluginSecretErrors,
  pluginSecretsPayload,
  pluginsNeededBy,
} from '../../app/utils/plugins'

const repository: PluginTypeInfo = {
  id: 'repository',
  name: 'Repository',
  description: 'The remote.',
  reach: ['Read branches.'],
  scopes: ['project'],
  singleInstance: true,
  configFields: [
    { kind: 'select', name: 'host', label: 'Host', options: [{ value: 'github', label: 'GitHub' }, { value: 'bitbucket', label: 'Bitbucket' }], required: true },
    { kind: 'string', name: 'owner', label: 'Owner', required: true, pattern: '[a-z]+' },
    { kind: 'string', name: 'defaultBranch', label: 'Default branch' },
    { kind: 'select', name: 'mode', label: 'Mode', options: [{ value: 'a', label: 'A' }] },
    { kind: 'boolean', name: 'verbose', label: 'Verbose', default: false },
  ],
  secretFields: [
    { name: 'token', label: 'Token', required: true },
    { name: 'extra', label: 'Extra' },
  ],
}

function instance(overrides: Partial<PluginInstance> = {}): PluginInstance {
  return {
    id: 'i1',
    type: 'repository',
    scope: 'project',
    projectId: 'p1',
    projectSlug: 'acme',
    config: { host: 'github', owner: 'jack', verbose: false },
    secrets: { token: 'set', extra: 'unset' },
    health: null,
    createdAt: '2026-10-28T00:00:00.000Z',
    updatedAt: '2026-10-28T00:00:00.000Z',
    ...overrides,
  }
}

describe('plugin form helpers', () => {
  it('starts a create draft from defaults, with required selects unchosen and optional ones explicitly unset', () => {
    const draft = pluginConfigDraft(repository.configFields)
    expect(draft).toEqual({
      text: { owner: '', defaultBranch: '' },
      choice: { host: undefined, mode: PLUGIN_SELECT_NONE },
      flag: { verbose: false },
    })
    expect(pluginConfigErrors(repository.configFields, draft).map(error => error.field)).toEqual(['host', 'owner'])
  })

  it('leaves blanks out on create and sends them as null on update so the merge removes them', () => {
    const draft = pluginConfigDraft(repository.configFields, instance().config)
    draft.text.owner = '  jack '
    expect(pluginConfigPayload(repository.configFields, draft)).toEqual({ host: 'github', owner: 'jack', verbose: false })
    expect(pluginConfigPayload(repository.configFields, draft, true)).toEqual({ host: 'github', owner: 'jack', defaultBranch: null, mode: null, verbose: false })
    draft.text.owner = 'Not Valid'
    expect(pluginConfigErrors(repository.configFields, draft)).toEqual([{ field: 'owner', message: 'Owner is not in the expected format.' }])
  })

  it('sends only typed or cleared secrets, never a kept one', () => {
    const drafts = pluginSecretDrafts(repository.secretFields, instance().secrets)
    expect(drafts).toEqual({ token: { mode: 'keep', value: '' }, extra: { mode: 'replace', value: '' } })
    expect(pluginSecretsPayload(repository.secretFields, drafts)).toBeUndefined()
    expect(pluginSecretErrors(repository.secretFields, drafts, instance().secrets)).toEqual([])

    drafts.token = { mode: 'replace', value: ' new-token \n' }
    drafts.extra = { mode: 'clear', value: '' }
    expect(pluginSecretsPayload(repository.secretFields, drafts)).toEqual({ token: 'new-token', extra: null })
  })

  it('requires a required secret on create, a value when replacing, and refuses to clear it', () => {
    const create = pluginSecretDrafts(repository.secretFields)
    expect(pluginSecretErrors(repository.secretFields, create)).toEqual([{ field: 'token', message: 'Token is required.' }])

    const saved = instance().secrets
    expect(pluginSecretErrors(repository.secretFields, { token: { mode: 'replace', value: ' ' } }, saved)[0]?.field).toBe('token')
    expect(pluginSecretErrors(repository.secretFields, { token: { mode: 'clear', value: '' } }, saved)[0]?.message).toMatch(/cannot be cleared/)
  })

  it('summarises config with option labels and skips absent fields', () => {
    expect(pluginConfigSummary(repository.configFields, instance().config)).toEqual([
      { name: 'host', label: 'Host', value: 'GitHub' },
      { name: 'owner', label: 'Owner', value: 'jack' },
      { name: 'verbose', label: 'Verbose', value: 'No' },
    ])
  })
})

describe('plugin availability', () => {
  it('offers a single-instance type only for scopes without an instance', () => {
    const both: PluginTypeInfo = { ...repository, scopes: ['project', 'global'] }
    expect(availablePluginScopes(both, [])).toEqual(['project', 'global'])
    expect(availablePluginScopes(both, [instance()])).toEqual(['global'])
    expect(availablePluginScopes({ ...both, singleInstance: false }, [instance()])).toEqual(['project', 'global'])
  })

  it('maps plugin readiness reasons to the capabilities waiting on them', () => {
    const registry = {
      capabilities: [
        { label: 'Bots', reasons: [{ kind: 'plugin', plugin: 'repository', message: '' }, { kind: 'plugin-any', plugins: ['claude-code', 'codex'], message: '' }] },
        { label: 'Team', reasons: [{ kind: 'plugin', plugin: 'repository', message: '' }, { kind: 'project-fact', fact: 'hasBots', message: '' }] },
      ],
    } as unknown as RegistryResponse
    expect(pluginsNeededBy(registry)).toEqual({ 'repository': ['Bots', 'Team'], 'claude-code': ['Bots'], 'codex': ['Bots'] })
    expect(pluginsNeededBy(null)).toEqual({})
  })
})

describe('plugin panels', () => {
  it('returns the panel registered for a type and nothing for others', () => {
    const panel = defineComponent({ name: 'FakePanel', render: () => null })
    registerPluginPanel('heroku', panel)
    expect(pluginPanelFor('heroku')).toBe(panel)
    expect(pluginPanelFor('netlify')).toBeUndefined()
  })
})

describe('plugin icons', () => {
  it('returns the icon registered for a type and the generic fallback for others', () => {
    registerPluginIcon('heroku', { src: '/heroku.svg', class: 'bg-white' })
    expect(pluginIconFor('heroku')).toEqual({ src: '/heroku.svg', class: 'bg-white' })
    expect(pluginIconFor('netlify')).toBe(PLUGIN_ICON_FALLBACK)
  })
})
