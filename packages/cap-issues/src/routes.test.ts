import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiErrorBody } from '@candy-mountain/platform-sdk'
import {
  workspaceIssuePath,
  workspaceIssuesPath,
  type IssueCommentListResponse,
  type IssueDependencyListResponse,
  type IssueListResponse,
  type IssueResponse,
} from './wire'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp, dataPaths, type PlatformDatabase } from '@candy-mountain/platform-daemon'
import { issuesTestProduct, openIssuesDatabase } from './test-support'
import { issuesRoutes } from './definition'
import { createTempBeadsWorkspace, hasBd, type TempBeadsWorkspace } from './test-workspace'
import { createWorkspaceWithRepository, repositoryPaths } from '@candy-mountain/plugin-repository'

describe.skipIf(!hasBd)('issue routes against a real workspace', () => {
  let workspace: TempBeadsWorkspace
  let database: PlatformDatabase
  let app: ReturnType<typeof createTestApp>
  let bare: string
  const ids = { epic: '', first: '', second: '', closed: '' }

  beforeAll(async () => {
    workspace = createTempBeadsWorkspace('rt')
    ids.epic = workspace.create('Epic', '--type', 'epic')
    ids.first = workspace.create('First', '--parent', ids.epic)
    ids.second = workspace.create('Second', '--parent', ids.epic, '--deps', ids.first, '--description', 'Needs **first**')
    ids.closed = workspace.create('Closed bug', '--type', 'bug')
    workspace.bd('close', ids.closed, '--reason', 'fixed')
    workspace.bd('comments', 'add', ids.first, 'hello from a test')

    bare = mkdtempSync(join(tmpdir(), 'candy-mountain-no-beads-'))
    database = openIssuesDatabase()
    app = createTestApp({ product: issuesTestProduct(), db: database.db, paths: dataPaths('/unused'), runtime: issuesRoutes(repositoryPaths(database.db)) })
    await createWorkspaceWithRepository(database.db, { name: 'Tracked', slug: 'tracked', path: workspace.path })
    await createWorkspaceWithRepository(database.db, { name: 'Bare', slug: 'bare', path: bare })
  }, 60_000)

  afterAll(() => {
    database?.close()
    workspace?.cleanup()
    if (bare) rmSync(bare, { recursive: true, force: true })
  })

  const get = (path: string) => app.request(path)

  it('lists every issue, closed included, with ready flags from bd ready', async () => {
    const res = await get(workspaceIssuesPath('tracked'))
    expect(res.status).toBe(200)
    const { issues } = await res.json() as IssueListResponse
    expect(issues.map(issue => issue.id).sort()).toEqual(Object.values(ids).sort())

    const ready = (workspace.bd('ready', '--limit', '0') as { id: string }[]).map(row => row.id).sort()
    expect(issues.filter(issue => issue.ready).map(issue => issue.id).sort()).toEqual(ready)
    expect(ready).toContain(ids.first)
    expect(ready).not.toContain(ids.second)

    const byId = new Map(issues.map(issue => [issue.id, issue]))
    expect(byId.get(ids.closed)).toMatchObject({ status: 'closed', type: 'bug', closeReason: 'fixed', ready: false })
    expect(byId.get(ids.first)).toMatchObject({ parentId: ids.epic, commentCount: 1 })
    expect(byId.get(ids.second)?.dependencies).toEqual(expect.arrayContaining([
      { issueId: ids.second, dependsOnId: ids.first, type: 'blocks' },
      { issueId: ids.second, dependsOnId: ids.epic, type: 'parent-child' },
    ]))
  }, 30_000)

  it('shows one issue with its neighbours', async () => {
    const res = await get(workspaceIssuePath('tracked', ids.second))
    expect(res.status).toBe(200)
    const { issue } = await res.json() as IssueResponse
    expect(issue).toMatchObject({ id: ids.second, title: 'Second', description: 'Needs **first**', parentId: ids.epic, ready: false })
    expect(issue.dependsOn.map(link => [link.id, link.dependencyType]).sort()).toEqual(
      [[ids.epic, 'parent-child'], [ids.first, 'blocks']].sort(),
    )

    const epic = (await (await get(workspaceIssuePath('tracked', ids.epic))).json() as IssueResponse).issue
    expect(epic.dependents.filter(link => link.dependencyType === 'parent-child').map(link => link.id).sort())
      .toEqual([ids.first, ids.second].sort())
  }, 30_000)

  it('answers 404 for an unknown issue id', async () => {
    const res = await get(workspaceIssuePath('tracked', 'rt-nope'))
    expect(res.status).toBe(404)
    expect((await res.json() as ApiErrorBody).error.code).toBe('not_found')
    expect((await get(`${workspaceIssuePath('tracked', 'rt-nope')}/comments`)).status).toBe(404)
  }, 30_000)

  it('returns dependencies for a set of ids', async () => {
    const res = await get(`${workspaceIssuesPath('tracked')}/dependencies?ids=${ids.first},${ids.second}`)
    expect(res.status).toBe(200)
    const { dependencies } = await res.json() as IssueDependencyListResponse
    expect(dependencies).toEqual(expect.arrayContaining([
      { issueId: ids.first, dependsOnId: ids.epic, type: 'parent-child' },
      { issueId: ids.second, dependsOnId: ids.first, type: 'blocks' },
      { issueId: ids.second, dependsOnId: ids.epic, type: 'parent-child' },
    ]))
    expect(dependencies).toHaveLength(3)
    expect((await get(`${workspaceIssuesPath('tracked')}/dependencies`)).status).toBe(400)
  }, 30_000)

  it('lists comments', async () => {
    const res = await get(`${workspaceIssuePath('tracked', ids.first)}/comments`)
    const { comments } = await res.json() as IssueCommentListResponse
    expect(comments).toMatchObject([{ issueId: ids.first, text: 'hello from a test' }])
  }, 30_000)

  it('explains a project without .beads', async () => {
    const res = await get(workspaceIssuesPath('bare'))
    expect(res.status).toBe(422)
    const body = await res.json() as ApiErrorBody
    expect(body.error.code).toBe('no_issue_tracker')
    expect(body.error.message).toContain(bare)
  })

  it('rejects unknown projects and ids that look like flags', async () => {
    expect((await get(workspaceIssuesPath('ghost'))).status).toBe(404)
    expect((await get(workspaceIssuePath('tracked', '--help'))).status).toBe(400)
  })
})
