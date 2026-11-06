import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACES_PATH, type ApiErrorBody } from '@candy-mountain/platform-sdk'
import { workspaceIssueEventsPath, type ProjectAssigneesResponse } from './wire'
import { afterEach, describe, expect, it } from 'vitest'
import { createTempDataDir, platformApp, type Platform, type Product, setEnabledModules, startTestPlatform, type TempDataDir, testProduct } from '@candy-mountain/platform-daemon'
import { ISSUE_WATCHER } from './definition'
import { issuesTestProduct } from './test-support'
import { createWorkspaceWithRepository, repositoryDefinition } from '@candy-mountain/cap-repository'

describe('the issues definition', () => {
  let temp: TempDataDir
  let checkout: string
  const open: Platform[] = []

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    temp?.cleanup()
    rmSync(checkout, { recursive: true, force: true })
  })

  async function start(product: Product = issuesTestProduct()) {
    temp = createTempDataDir()
    checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-issues-'))
    mkdirSync(join(checkout, '.beads'))
    const platform = startTestPlatform(temp.root, { product })
    open.push(platform)
    const project = await createWorkspaceWithRepository(platform.db, { name: 'Alpha', slug: 'alpha', path: checkout })
    setEnabledModules(platform.db, project.id, platform.modules.list().map(m => m.id))
    const app = platformApp(platform)
    return { platform, app, project }
  }

  it('serves the issue, assignee and event stream routes with its watcher running', async () => {
    const { platform, app, project } = await start()

    const watcher = platform.runtime.service(ISSUE_WATCHER)
    expect(watcher?.signal.aborted).toBe(false)
    watcher?.reconcile()
    expect(watcher?.isWatching(project.id)).toBe(true)
    const assignees = await app.request(`${WORKSPACES_PATH}/alpha/assignees`)
    expect(assignees.status).toBe(200)
    expect(await assignees.json()).toEqual<ProjectAssigneesResponse>({ assignees: [] })
    const unknown = await app.request(`${WORKSPACES_PATH}/nope/issues`)
    expect(unknown.status).toBe(404)
    expect(((await unknown.json()) as ApiErrorBody).error.code).toBe('not_found')
    const events = await app.request(workspaceIssueEventsPath('alpha'))
    expect(events.headers.get('content-type')).toBe('text/event-stream')
    await events.body!.cancel()
  })

  it('closes its watcher with the platform, ending open event streams', async () => {
    const { platform, app } = await start()
    const watcher = platform.runtime.service(ISSUE_WATCHER)!
    const reader = (await app.request(workspaceIssueEventsPath('alpha'))).body!.getReader()
    await reader.read()

    await platform.close()

    expect(watcher.signal.aborted).toBe(true)
    let done = false
    while (!done) ({ done } = await reader.read())
  })

  it('boots without issues and its routes answer plain not found', async () => {
    const { platform, app } = await start(testProduct({ capabilities: [repositoryDefinition()] }))

    expect(platform.runtime.service(ISSUE_WATCHER)).toBeUndefined()
    expect(platform.runtime.started.map(s => s.definition.id)).not.toContain('issues')
    for (const path of [`${WORKSPACES_PATH}/alpha/issues`, `${WORKSPACES_PATH}/alpha/assignees`, workspaceIssueEventsPath('alpha')]) {
      const res = await app.request(path)
      expect(res.status).toBe(404)
      expect(await res.text()).toBe('404 Not Found')
    }
    expect((await app.request(`${WORKSPACES_PATH}/alpha`)).status).toBe(200)
  })
})
