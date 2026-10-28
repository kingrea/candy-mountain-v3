import type { Environment, LiveVersionSourceField, LiveVersionSourceInfo, PluginInstance } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import {
  deploymentsCreateBody,
  deploymentsLinkText,
  deploymentsLiveState,
  deploymentsSettingsDraft,
  deploymentsSettingsErrors,
  deploymentsShortVersion,
  deploymentsSourceChoices,
  deploymentsSourcePluginReason,
  deploymentsUpdateBody,
} from '../../app/utils/deployments'

const ENDPOINT_FIELDS: LiveVersionSourceField[] = [
  { kind: 'string', name: 'url', label: 'Endpoint URL', required: true, pattern: 'https?://\\S+' },
  { kind: 'string', name: 'versionPath', label: 'Version path' },
  { kind: 'string', name: 'branchPath', label: 'Branch path' },
]
const custom: LiveVersionSourceInfo = { id: 'custom-endpoint', label: 'Version endpoint', description: 'Reads JSON.', fields: ENDPOINT_FIELDS }
const netlify: LiveVersionSourceInfo = { id: 'netlify', label: 'Netlify', description: 'Netlify deploys.', fields: [] }
const heroku: LiveVersionSourceInfo = { id: 'heroku', label: 'Heroku', description: 'Heroku releases.', fields: [] }
const SOURCES = [custom, netlify, heroku]

function instance(type: string, health: PluginInstance['health'], scope: PluginInstance['scope'] = 'project'): PluginInstance {
  return {
    id: `${type}-${scope}`,
    type: type as PluginInstance['type'],
    scope,
    projectId: scope === 'project' ? 'p1' : null,
    projectSlug: scope === 'project' ? 'acme' : null,
    config: {},
    secrets: {},
    health,
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
  }
}
const healthy = { healthy: true, checkedAt: '2026-10-28T00:00:00Z' } as const
const unhealthy = { healthy: false, reason: 'Bad token.', checkedAt: '2026-10-28T00:00:00Z' } as const

function environment(patch: Partial<Environment> = {}): Environment {
  return {
    id: 'e1',
    projectId: 'p1',
    name: 'Production',
    liveSourceKind: 'custom-endpoint',
    liveSourceSettings: { url: 'https://shop.example.com/api/debug', versionPath: 'commit' },
    deployKind: null,
    deploySettings: null,
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
    ...patch,
  }
}

describe('source choices', () => {
  it('lists a vendor source only while its plugin is set up and healthy', () => {
    expect(deploymentsSourcePluginReason(custom, [])).toBeNull()
    expect(deploymentsSourcePluginReason(netlify, [])).toMatch(/not set up/)
    expect(deploymentsSourcePluginReason(netlify, [instance('netlify', null)])).toMatch(/not been tested/)
    expect(deploymentsSourcePluginReason(netlify, [instance('netlify', unhealthy)])).toMatch(/unhealthy: Bad token/)
    expect(deploymentsSourcePluginReason(netlify, [instance('netlify', healthy)])).toBeNull()

    const choices = deploymentsSourceChoices(SOURCES, [instance('netlify', healthy), instance('heroku', unhealthy)])
    expect(choices.available.map(s => s.id)).toEqual(['custom-endpoint', 'netlify'])
    expect(choices.hidden.map(s => s.id)).toEqual(['heroku'])
  })

  it('resolves the project instance before the platform-wide one', () => {
    expect(deploymentsSourcePluginReason(heroku, [instance('heroku', unhealthy), instance('heroku', healthy, 'global')])).toMatch(/unhealthy/)
    expect(deploymentsSourcePluginReason(heroku, [instance('heroku', healthy, 'global')])).toBeNull()
  })

  it('keeps the stored kind so an environment stays editable after its plugin breaks', () => {
    expect(deploymentsSourceChoices(SOURCES, [], 'heroku').available.map(s => s.id)).toEqual(['custom-endpoint', 'heroku'])
  })
})

describe('environment requests', () => {
  it('builds settings from the stored values and validates them with the shared rules', () => {
    const draft = deploymentsSettingsDraft(ENDPOINT_FIELDS, environment().liveSourceSettings)
    expect(draft).toEqual({ url: 'https://shop.example.com/api/debug', versionPath: 'commit', branchPath: '' })
    expect(deploymentsSettingsErrors(ENDPOINT_FIELDS, { ...draft, url: 'ftp://x' })).toEqual([{ field: 'url', message: 'Endpoint URL is not in the expected format.' }])
    expect(deploymentsCreateBody(ENDPOINT_FIELDS, { name: ' Staging ', kind: 'custom-endpoint', settings: { ...draft, branchPath: ' branch ' } })).toEqual({
      name: 'Staging',
      liveSourceKind: 'custom-endpoint',
      liveSourceSettings: { url: 'https://shop.example.com/api/debug', versionPath: 'commit', branchPath: 'branch' },
    })
  })

  it('sends only the name on a rename so the source is not re-checked', () => {
    const env = environment()
    const settings = deploymentsSettingsDraft(ENDPOINT_FIELDS, env.liveSourceSettings)
    expect(deploymentsUpdateBody(env, ENDPOINT_FIELDS, { name: 'Live', kind: 'custom-endpoint', settings })).toEqual({ name: 'Live' })
    expect(deploymentsUpdateBody(environment({ liveSourceKind: 'netlify', liveSourceSettings: {} }), [], { name: 'Live', kind: 'netlify', settings: {} })).toEqual({ name: 'Live' })
  })

  it('sends the settings whole when they or the kind change', () => {
    const env = environment()
    const settings = { ...deploymentsSettingsDraft(ENDPOINT_FIELDS, env.liveSourceSettings), branchPath: 'branch' }
    expect(deploymentsUpdateBody(env, ENDPOINT_FIELDS, { name: 'Production', kind: 'custom-endpoint', settings })).toEqual({
      liveSourceSettings: { url: 'https://shop.example.com/api/debug', versionPath: 'commit', branchPath: 'branch' },
    })
    expect(deploymentsUpdateBody(env, [], { name: 'Production', kind: 'netlify', settings: {} })).toEqual({ liveSourceKind: 'netlify', liveSourceSettings: {} })
  })
})

describe('live state', () => {
  const entry = (live: { ok: true, version: Record<string, string> } | { ok: false, error: string }) =>
    ({ environmentId: 'e1', environmentName: 'Production', liveSourceKind: 'netlify', checkedAt: '2026-10-28T00:00:00Z', live })

  it('tells loading, failure, nothing deployed and a live version apart', () => {
    expect(deploymentsLiveState(undefined, false)).toEqual({ state: 'loading' })
    expect(deploymentsLiveState(undefined, true)).toEqual({ state: 'unavailable' })
    expect(deploymentsLiveState(entry({ ok: false, error: 'The Netlify plugin is unhealthy: Bad token.' }), false)).toMatchObject({ state: 'error', error: 'The Netlify plugin is unhealthy: Bad token.' })
    expect(deploymentsLiveState(entry({ ok: true, version: {} }), false)).toMatchObject({ state: 'empty' })
    expect(deploymentsLiveState(entry({ ok: true, version: { branch: 'main' } }), false)).toMatchObject({ state: 'live', version: { branch: 'main' } })
  })

  it('shortens a full SHA and shows a link without its scheme', () => {
    expect(deploymentsShortVersion('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678')).toBe('a1b2c3d')
    expect(deploymentsShortVersion('v42')).toBe('v42')
    expect(deploymentsLinkText('https://shop.example.com/')).toBe('shop.example.com')
    expect(deploymentsLinkText('https://app.netlify.com/sites/shop/deploys/1')).toBe('app.netlify.com/sites/shop/deploys/1')
  })
})
