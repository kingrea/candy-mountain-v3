import { WORKSPACES_PATH } from '@candy-mountain/platform-sdk'
import { LIVE_VERSION_SOURCES_PATH, type EnvironmentListResponse, type LiveVersionSourceListResponse, type LiveVersionsResponse } from './wire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnvironment } from './service'
import { createLiveVersionSourceRegistry, defineLiveVersionSource, LiveVersionSourceError } from './sources'
import { LIVE_VERSION_SOURCES } from './builtin-sources'
import { createTempDataDir, createWorkspace, type Platform, platformApp, startTestPlatform, type TempDataDir, type TestPlatformOptions } from '@candy-mountain/platform-daemon'
import { deploymentsDefinition } from './definition'
import { REPOSITORY_STAND_IN, startDeploymentsPlatform } from './test-support'

const pinned = defineLiveVersionSource({
  id: 'pinned',
  label: 'Pinned',
  description: 'Reads one fixed URL through the fetch it is handed.',
  fields: [],
  async read({ fetch }) {
    return { version: await (await fetch('https://pinned.example.com/version')).text() }
  },
})

describe('the deployments definition', () => {
  let temp: TempDataDir
  const open: Platform[] = []

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    temp?.cleanup()
  })

  function start(options: TestPlatformOptions = {}) {
    temp = createTempDataDir()
    const platform = startDeploymentsPlatform(temp.root, options)
    open.push(platform)
    const project = createWorkspace(platform.db, { name: 'Alpha', slug: 'alpha' })
    const app = platformApp(platform)
    return { platform, app, project }
  }

  it('serves the environment and live version source routes and brings the netlify and heroku plugin types', async () => {
    const { platform, app } = start()

    expect(platform.runtime.started.map(s => s.definition.id)).toContain('deployments')
    expect(platform.migrationSets.map(set => set.id)).toContain('deployments')
    expect(platform.pluginTypes.has('netlify')).toBe(true)
    expect(platform.pluginTypes.has('heroku')).toBe(true)
    const environments = await app.request(`${WORKSPACES_PATH}/alpha/environments`)
    expect(environments.status).toBe(200)
    expect(await environments.json()).toEqual<EnvironmentListResponse>({ environments: [] })
    const sources = await app.request(LIVE_VERSION_SOURCES_PATH)
    expect(sources.status).toBe(200)
    expect(((await sources.json()) as LiveVersionSourceListResponse).sources.map(s => s.id)).toEqual(['custom-endpoint', 'netlify', 'heroku'])
  })

  it('reads live versions through the sources and fetch it is given', async () => {
    const fetch = vi.fn(async () => new Response('v42'))
    const deployments = deploymentsDefinition({ sources: [pinned], fetch })
    const { platform, app, project } = start({ capabilities: [deployments] })
    createEnvironment({ db: platform.db, pluginTypes: platform.pluginTypes, secrets: platform.secrets.writeOnly }, project.id, { name: 'Production', liveSourceKind: 'pinned' }, createLiveVersionSourceRegistry([pinned]))

    const sources = (await (await app.request(LIVE_VERSION_SOURCES_PATH)).json()) as LiveVersionSourceListResponse
    expect(sources.sources.map(s => s.id)).toEqual(['pinned'])
    const { environments } = (await (await app.request(`${WORKSPACES_PATH}/alpha/live-versions`)).json()) as LiveVersionsResponse
    expect(environments.map(e => e.live)).toEqual([{ ok: true, version: { version: 'v42' } }])
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('boots without deployments: no environments set, no netlify or heroku plugin type, and its routes answer plain not found', async () => {
    const { platform, app } = start({ capabilities: [] })

    expect(platform.runtime.started.map(s => s.definition.id)).not.toContain('deployments')
    expect(platform.migrationSets.map(set => set.id)).not.toContain('deployments')
    expect(platform.pluginTypes.has('netlify')).toBe(false)
    expect(platform.pluginTypes.has('heroku')).toBe(false)
    expect(platform.pluginTypes.has('repository')).toBe(true)
    for (const path of [`${WORKSPACES_PATH}/alpha/environments`, `${WORKSPACES_PATH}/alpha/live-versions`, LIVE_VERSION_SOURCES_PATH]) {
      const res = await app.request(path)
      expect(res.status, path).toBe(404)
      expect(await res.text(), path).toBe('404 Not Found')
    }
    expect((await app.request(`${WORKSPACES_PATH}/alpha`)).status).toBe(200)
  })

  it('refuses boot when a source reads a plugin type nothing registers', () => {
    temp = createTempDataDir()
    const render = defineLiveVersionSource({ ...pinned, id: 'render-deploy', plugin: 'render' })
    const boot = () => startTestPlatform(temp.root, { capabilities: [deploymentsDefinition({ sources: [...LIVE_VERSION_SOURCES, render] })], pluginTypes: [REPOSITORY_STAND_IN] })

    expect(boot).toThrow(LiveVersionSourceError)
    expect(boot).toThrow("Live-version source 'render-deploy': plugin type 'render' is not registered.")
  })
})
