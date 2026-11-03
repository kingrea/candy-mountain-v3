import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACES_PATH, type TeamMemberListResponse } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { type Platform, setEnabledModules } from '@candy-mountain/platform-daemon'
import { createTestApp, startTestPlatform, withoutCapabilities, type TestPlatformOptions } from '../testing/platform'
import { createTempDataDir, type TempDataDir } from '../testing'
import { createWorkspaceWithRepository } from '../repository/test-support'

describe('the team definition', () => {
  let temp: TempDataDir
  let checkout: string
  const open: Platform[] = []

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    temp?.cleanup()
    rmSync(checkout, { recursive: true, force: true })
  })

  async function start(options: TestPlatformOptions = {}) {
    temp = createTempDataDir()
    checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-team-'))
    mkdirSync(join(checkout, '.beads'))
    const platform = startTestPlatform(temp.root, options)
    open.push(platform)
    const project = await createWorkspaceWithRepository(platform.db, { name: 'Alpha', slug: 'alpha', path: checkout })
    setEnabledModules(platform.db, project.id, platform.modules.list().map(m => m.id))
    const app = createTestApp({ db: platform.db, paths: platform.paths, capabilities: platform.capabilities, modules: platform.modules, runtime: platform.runtime })
    return { platform, app }
  }

  it('serves the team routes', async () => {
    const { platform, app } = await start()

    expect(platform.runtime.started.map(s => s.definition.id)).toContain('team')
    const res = await app.request(`${WORKSPACES_PATH}/alpha/team`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual<TeamMemberListResponse>({ members: [] })
  })

  it('boots without team and its routes answer plain not found', async () => {
    const { platform, app } = await start(withoutCapabilities('team'))

    expect(platform.runtime.started.map(s => s.definition.id)).not.toContain('team')
    const res = await app.request(`${WORKSPACES_PATH}/alpha/team`)
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('404 Not Found')
    expect((await app.request(`${WORKSPACES_PATH}/alpha`)).status).toBe(200)
  })
})
