import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LIVE_VERSION_SOURCES_PATH, PROJECTS_PATH, type EnvironmentListResponse, type LiveVersionSourceListResponse, type LiveVersionsResponse } from '@candy-mountain/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEnvironment } from '../environments/service'
import { createLiveVersionSourceRegistry, defineLiveVersionSource, LiveVersionSourceError } from '../environments/sources'
import { LIVE_VERSION_SOURCES } from '../environments/builtin-sources'
import type { Platform } from '../platform'
import { CAPABILITY_DEFINITIONS, createTestApp, startTestPlatform, withoutCapabilities, type TestPlatformOptions } from '../testing/platform'
import { setEnabledModules } from '../project-modules'
import { createProject } from '../projects/projects'
import { createTempDataDir, type TempDataDir } from '../testing'
import { deploymentsDefinition } from './definition'

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
  let checkout: string
  const open: Platform[] = []

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    temp?.cleanup()
    if (checkout) rmSync(checkout, { recursive: true, force: true })
  })

  async function start(options: TestPlatformOptions = {}) {
    temp = createTempDataDir()
    checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-deployments-'))
    mkdirSync(join(checkout, '.beads'))
    const platform = startTestPlatform(temp.root, options)
    open.push(platform)
    const project = await createProject(platform.db, { name: 'Alpha', slug: 'alpha', source: { kind: 'local-path', path: checkout } })
    setEnabledModules(platform.db, project.id, platform.modules.list().map(m => m.id))
    const app = createTestApp({ db: platform.db, paths: platform.paths, capabilities: platform.capabilities, modules: platform.modules, pluginTypes: platform.pluginTypes, runtime: platform.runtime })
    return { platform, app, project }
  }

  it('serves the environment and live version source routes and brings the netlify and heroku plugin types', async () => {
    const { platform, app } = await start()

    expect(platform.runtime.started.map(s => s.definition.id)).toContain('deployments')
    expect(platform.pluginTypes.has('netlify')).toBe(true)
    expect(platform.pluginTypes.has('heroku')).toBe(true)
    const environments = await app.request(`${PROJECTS_PATH}/alpha/environments`)
    expect(environments.status).toBe(200)
    expect(await environments.json()).toEqual<EnvironmentListResponse>({ environments: [] })
    const sources = await app.request(LIVE_VERSION_SOURCES_PATH)
    expect(sources.status).toBe(200)
    expect(((await sources.json()) as LiveVersionSourceListResponse).sources.map(s => s.id)).toEqual(['custom-endpoint', 'netlify', 'heroku'])
  })

  it('reads live versions through the sources and fetch it is given', async () => {
    const fetch = vi.fn(async () => new Response('v42'))
    const deployments = deploymentsDefinition({ sources: [pinned], fetch })
    const { platform, app, project } = await start({ capabilities: CAPABILITY_DEFINITIONS.map(c => (c.id === 'deployments' ? deployments : c)) })
    createEnvironment({ db: platform.db, pluginTypes: platform.pluginTypes, secrets: platform.secrets.writeOnly }, project.id, { name: 'Production', liveSourceKind: 'pinned' }, createLiveVersionSourceRegistry([pinned]))

    const sources = (await (await app.request(LIVE_VERSION_SOURCES_PATH)).json()) as LiveVersionSourceListResponse
    expect(sources.sources.map(s => s.id)).toEqual(['pinned'])
    const { environments } = (await (await app.request(`${PROJECTS_PATH}/alpha/live-versions`)).json()) as LiveVersionsResponse
    expect(environments.map(e => e.live)).toEqual([{ ok: true, version: { version: 'v42' } }])
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('boots without deployments: no netlify or heroku plugin type and its routes answer plain not found', async () => {
    const { platform, app } = await start(withoutCapabilities('deployments'))

    expect(platform.runtime.started.map(s => s.definition.id)).not.toContain('deployments')
    expect(platform.pluginTypes.has('netlify')).toBe(false)
    expect(platform.pluginTypes.has('heroku')).toBe(false)
    expect(platform.pluginTypes.has('repository')).toBe(true)
    for (const path of [`${PROJECTS_PATH}/alpha/environments`, `${PROJECTS_PATH}/alpha/live-versions`, LIVE_VERSION_SOURCES_PATH]) {
      const res = await app.request(path)
      expect(res.status, path).toBe(404)
      expect(await res.text(), path).toBe('404 Not Found')
    }
    expect((await app.request(`${PROJECTS_PATH}/alpha`)).status).toBe(200)
  })

  it('refuses boot when a source reads a plugin type nothing registers', () => {
    temp = createTempDataDir()
    const render = defineLiveVersionSource({ ...pinned, id: 'render-deploy', plugin: 'render' })
    const boot = () => startTestPlatform(temp.root, { capabilities: [deploymentsDefinition({ sources: [...LIVE_VERSION_SOURCES, render] })], modules: [] })

    expect(boot).toThrow(LiveVersionSourceError)
    expect(boot).toThrow("Live-version source 'render-deploy': plugin type 'render' is not registered.")
  })
})
