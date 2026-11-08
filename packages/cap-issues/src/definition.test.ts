import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACES_PATH, type ApiErrorBody } from '@candy-mountain/platform-sdk'
import { workspaceIssueEventsPath, type ProjectAssigneesResponse } from './wire'
import { afterEach, describe, expect, it } from 'vitest'
import { testKit, testProduct, type TestKit } from '@candy-mountain/platform-daemon/testing'
import type { Product } from '@candy-mountain/platform-daemon'
import { ISSUE_WATCHER } from './definition'
import { issuesTestProduct, workspaceAt } from './test-support'
import { repositoryDefinition } from '@candy-mountain/plugin-repository'

describe('the issues definition', () => {
  let kit: TestKit | undefined
  let checkout: string

  afterEach(async () => {
    await kit?.close()
    kit = undefined
    rmSync(checkout, { recursive: true, force: true })
  })

  async function start(product: Product = issuesTestProduct()) {
    checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-issues-'))
    mkdirSync(join(checkout, '.beads'))
    kit = testKit({ product })
    const project = await workspaceAt(kit, checkout, { name: 'Alpha', slug: 'alpha' })
    return { platform: kit.platform, app: kit.admin, project }
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
