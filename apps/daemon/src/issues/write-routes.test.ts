import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  projectIssueClosePath,
  projectIssueCommentPath,
  projectIssueCommentsPath,
  projectIssuePath,
  projectIssuesBulkPath,
  projectIssuesPath,
  type ApiErrorBody,
  type BulkUpdateIssuesResponse,
  type CreateIssueResponse,
  type IssueCommentResponse,
  type IssueListResponse,
  type IssueResponse,
} from '@candy-mountain/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestApp } from '../testing/platform'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { setEnabledModules } from '../project-modules/enablement'
import { createProject } from '../projects'
import { openTestDatabase } from '../testing'
import { issuesRoutes } from './definition'
import { createTempBeadsWorkspace, hasBd, type TempBeadsWorkspace } from './test-workspace'

type Row = Record<string, unknown>

describe.skipIf(!hasBd)('issue write routes against a real workspace', () => {
  let workspace: TempBeadsWorkspace
  let database: PlatformDatabase
  let app: ReturnType<typeof createTestApp>
  const ids = { epic: '', first: '', second: '' }

  beforeAll(async () => {
    workspace = createTempBeadsWorkspace('wr')
    ids.epic = workspace.create('Epic', '--type', 'epic')
    ids.first = workspace.create('First')
    ids.second = workspace.create('Second')
    database = openTestDatabase()
    app = createTestApp({ db: database.db, paths: dataPaths('/unused'), runtime: issuesRoutes() })
    const project = await createProject(database.db, { name: 'Tracked', slug: 'tracked', source: { kind: 'local-path', path: workspace.path } })
    setEnabledModules(database.db, project.id, ['issues'])
  }, 60_000)

  afterAll(() => {
    database?.close()
    workspace?.cleanup()
  })

  const send = (method: string, path: string, body?: unknown) => app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const show = (id: string) => (workspace.bd('show', id) as Row[])[0]!
  const comments = (id: string) => workspace.bd('comments', id) as Row[]

  it('creates an issue with every field, a parent and two dependencies', async () => {
    const res = await send('POST', projectIssuesPath('tracked'), {
      title: '-starts with a dash',
      type: 'bug',
      priority: 1,
      labels: ['ui', 'urgent'],
      parentId: ids.epic,
      description: 'Line one\n--not-a-flag',
      acceptanceCriteria: 'It works',
      notes: 'Some notes',
      assignee: 'jack',
      dependsOn: [ids.first, ids.second],
    })
    expect(res.status).toBe(201)
    const { issue, warnings } = await res.json() as CreateIssueResponse
    expect(warnings).toEqual([])
    expect(issue).toMatchObject({ title: '-starts with a dash', parentId: ids.epic, type: 'bug', priority: 1 })

    const row = show(issue.id)
    expect(row).toMatchObject({
      title: '-starts with a dash',
      issue_type: 'bug',
      priority: 1,
      parent: ids.epic,
      description: 'Line one\n--not-a-flag',
      acceptance_criteria: 'It works',
      notes: 'Some notes',
      assignee: 'jack',
      created_by: 'admin',
    })
    expect(row.labels).toEqual(expect.arrayContaining(['ui', 'urgent']))
    const deps = (row.dependencies as Row[]).map(dep => [dep.id, dep.dependency_type])
    expect(deps).toEqual(expect.arrayContaining([[ids.first, 'blocks'], [ids.second, 'blocks'], [ids.epic, 'parent-child']]))
  }, 30_000)

  it('creates the issue but reports a dependency bd refuses', async () => {
    const res = await send('POST', projectIssuesPath('tracked'), { title: 'Loose', dependsOn: ['wr-nope'] })
    expect(res.status).toBe(201)
    const { issue, warnings } = await res.json() as CreateIssueResponse
    expect(show(issue.id).title).toBe('Loose')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('wr-nope')
  }, 30_000)

  it('updates fields, replaces labels and detaches with an empty parent', async () => {
    const id = workspace.create('Before', '--parent', ids.epic, '--labels', 'old', '--description', 'old text', '--assignee', 'someone')
    const res = await send('PATCH', projectIssuePath('tracked', id), {
      title: 'After',
      description: 'new **text**',
      acceptanceCriteria: 'accepted',
      notes: 'noted',
      type: 'feature',
      priority: 0,
      labels: ['fresh', 'tags'],
      assignee: 'jack',
      status: 'in_progress',
    })
    expect(res.status).toBe(200)
    expect((await res.json() as IssueResponse).issue).toMatchObject({ id, title: 'After', priority: 0, status: 'in_progress' })
    expect(show(id)).toMatchObject({
      title: 'After',
      description: 'new **text**',
      acceptance_criteria: 'accepted',
      notes: 'noted',
      issue_type: 'feature',
      priority: 0,
      labels: ['fresh', 'tags'],
      assignee: 'jack',
      status: 'in_progress',
      parent: ids.epic,
    })

    const cleared = await send('PATCH', projectIssuePath('tracked', id), { parentId: null, labels: [], assignee: null, description: '' })
    expect(cleared.status).toBe(200)
    const row = show(id)
    expect(row.parent).toBeUndefined()
    expect(row.labels).toBeUndefined()
    expect(row.assignee).toBeUndefined()
    expect(row.description).toBeUndefined()
    expect((await cleared.json() as IssueResponse).issue).toMatchObject({ parentId: null, labels: [], assignee: null })
  }, 30_000)

  it('shows an update in the list straight away despite the cache', async () => {
    const created = await send('POST', projectIssuesPath('tracked'), { title: 'Cached title' })
    const { id } = (await created.json() as CreateIssueResponse).issue
    const listed = async () => ((await (await send('GET', projectIssuesPath('tracked'))).json()) as IssueListResponse).issues
    expect((await listed()).find(issue => issue.id === id)?.title).toBe('Cached title')
    await send('PATCH', projectIssuePath('tracked', id), { title: 'Fresh title' })
    expect((await listed()).find(issue => issue.id === id)?.title).toBe('Fresh title')
  }, 30_000)

  it('closes with a reason', async () => {
    const id = workspace.create('To close')
    const res = await send('POST', projectIssueClosePath('tracked', id), { reason: 'done and dusted' })
    expect(res.status).toBe(200)
    expect((await res.json() as IssueResponse).issue).toMatchObject({ status: 'closed', closeReason: 'done and dusted' })
    expect(show(id)).toMatchObject({ status: 'closed', close_reason: 'done and dusted' })

    const bare = workspace.create('Closed without a body')
    expect((await send('POST', projectIssueClosePath('tracked', bare))).status).toBe(200)
    expect(show(bare).status).toBe('closed')
  }, 30_000)

  it('refuses to close an epic with open children unless forced', async () => {
    const epic = workspace.create('Busy epic', '--type', 'epic')
    workspace.create('Open child', '--parent', epic)
    const refused = await send('POST', projectIssueClosePath('tracked', epic), {})
    expect(refused.status).toBe(502)
    expect((await refused.json() as ApiErrorBody).error.message).toContain('open child')
    expect((await send('POST', projectIssueClosePath('tracked', epic), { force: true })).status).toBe(200)
    expect(show(epic).status).toBe('closed')
  }, 30_000)

  it('applies one change to five issues in one request', async () => {
    const five = ['B1', 'B2', 'B3', 'B4', 'B5'].map(title => workspace.create(title))
    const target = workspace.create('Bulk epic', '--type', 'epic')
    const res = await send('POST', projectIssuesBulkPath('tracked'), {
      ids: [...five, 'wr-nope'],
      changes: { priority: 4, parentId: target, assignee: 'bulk-person', addLabels: ['bulk'], status: 'in_progress' },
    })
    expect(res.status).toBe(200)
    expect(await res.json() as BulkUpdateIssuesResponse).toEqual({ updatedIds: five, missingIds: ['wr-nope'] })

    const listed = new Map((workspace.bd('list', '--all', '--limit', '0') as Row[]).map(row => [row.id, row]))
    for (const id of five) {
      expect(listed.get(id)).toMatchObject({ priority: 4, assignee: 'bulk-person', labels: ['bulk'], status: 'in_progress' })
      expect(show(id).parent).toBe(target)
    }

    const detached = await send('POST', projectIssuesBulkPath('tracked'), { ids: five, changes: { parentId: null, removeLabels: ['bulk'] } })
    expect(detached.status).toBe(200)
    for (const id of five) {
      const row = show(id)
      expect(row.parent).toBeUndefined()
      expect(row.labels).toBeUndefined()
    }

    const none = await send('POST', projectIssuesBulkPath('tracked'), { ids: ['wr-nope', 'wr-gone'], changes: { priority: 1 } })
    expect(await none.json() as BulkUpdateIssuesResponse).toEqual({ updatedIds: [], missingIds: ['wr-nope', 'wr-gone'] })
  }, 60_000)

  it('adds a comment whose text starts with a dash', async () => {
    const res = await send('POST', projectIssueCommentsPath('tracked', ids.first), { text: '--looks like a flag' })
    expect(res.status).toBe(201)
    const { comment } = await res.json() as IssueCommentResponse
    expect(comment).toMatchObject({ issueId: ids.first, text: '--looks like a flag', author: 'admin' })
    expect(comments(ids.first).map(row => row.text)).toContain('--looks like a flag')
  }, 30_000)

  it('edits a comment so a fresh bd read sees the new text', async () => {
    workspace.bd('comments', 'add', ids.second, 'first draft')
    workspace.bd('comments', 'add', ids.second, 'untouched neighbour')
    const target = comments(ids.second).find(row => row.text === 'first draft')!
    const text = 'Edited: it\'s "quoted" \\ back\\slash, ünïcödé 🍭\nnew line\'); DELETE FROM comments; --'

    const res = await send('PATCH', projectIssueCommentPath('tracked', ids.second, String(target.id)), { text })
    expect(res.status).toBe(200)
    expect((await res.json() as IssueCommentResponse).comment).toMatchObject({ id: target.id, issueId: ids.second, text, author: target.author })

    const after = comments(ids.second)
    expect(after.find(row => row.id === target.id)?.text).toBe(text)
    expect(after.find(row => row.text === 'untouched neighbour')).toBeDefined()

    // bd still writes normally afterwards and the edit is committed rather than left in the working set.
    workspace.bd('comments', 'add', ids.second, 'after the edit')
    expect(comments(ids.second).find(row => row.id === target.id)?.text).toBe(text)
    const shown = workspace.bd('dolt', 'show') as { data_dir: string, database: string }
    const status = execFileSync('dolt', ['--data-dir', shown.data_dir, 'sql', '-r', 'csv', '-q', `USE \`${shown.database}\`; SELECT COUNT(*) AS n FROM dolt_status`], { encoding: 'utf8' })
    expect(status.trim().split('\n').at(-1)).toBe('0')
  }, 30_000)

  it('answers 404 for a comment that is not on the issue', async () => {
    const other = comments(ids.first)[0]!
    const res = await send('PATCH', projectIssueCommentPath('tracked', ids.second, String(other.id)), { text: 'nope' })
    expect(res.status).toBe(404)
    expect(comments(ids.first)[0]!.text).toBe(other.text)
    expect((await send('PATCH', projectIssueCommentPath('tracked', ids.second, '00000000-0000-0000-0000-000000000000'), { text: 'x' })).status).toBe(404)
  }, 30_000)

  it('answers 404 for unknown issues and projects', async () => {
    expect((await send('PATCH', projectIssuePath('tracked', 'wr-nope'), { title: 'x' })).status).toBe(404)
    expect((await send('POST', projectIssueClosePath('tracked', 'wr-nope'), {})).status).toBe(404)
    expect((await send('POST', projectIssueCommentsPath('tracked', 'wr-nope'), { text: 'x' })).status).toBe(404)
    expect((await send('POST', projectIssuesPath('ghost'), { title: 'x' })).status).toBe(404)
  }, 30_000)

  it('refuses writes while the module is off or the project has no .beads directory', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'cm-plain-'))
    try {
      const project = await createProject(database.db, { name: 'Plain', slug: 'plain', source: { kind: 'local-path', path: plain } })
      const off = await send('POST', projectIssuesPath('plain'), { title: 'x' })
      expect(off.status).toBe(404)
      expect((await off.json() as ApiErrorBody).error.code).toBe('not_enabled')

      setEnabledModules(database.db, project.id, ['issues'])
      const comment = await send('POST', projectIssueCommentsPath('plain', 'wr-x'), { text: 'x' })
      expect(comment.status).toBe(409)
      expect((await comment.json() as ApiErrorBody).error).toMatchObject({ code: 'not_ready', message: expect.stringContaining('.beads') })
    }
    finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  it.each([
    ['POST', () => projectIssuesPath('tracked'), {}],
    ['POST', () => projectIssuesPath('tracked'), { title: '   ' }],
    ['POST', () => projectIssuesPath('tracked'), { title: 'x', priority: 9 }],
    ['POST', () => projectIssuesPath('tracked'), { title: 'x', dependsOn: ['--help'] }],
    ['POST', () => projectIssuesPath('tracked'), { title: 'x', labels: ['a,b'] }],
    ['POST', () => projectIssuesPath('tracked'), { title: 'x', surprise: true }],
    ['POST', () => projectIssuesPath('tracked'), '{not json'],
    ['PATCH', () => projectIssuePath('tracked', ids.first), {}],
    ['PATCH', () => projectIssuePath('tracked', ids.first), { type: '--force' }],
    ['PATCH', () => projectIssuePath('tracked', '--help'), { title: 'x' }],
    ['POST', () => projectIssueClosePath('tracked', ids.first), { force: 'yes' }],
    ['POST', () => projectIssuesBulkPath('tracked'), { ids: [], changes: { priority: 1 } }],
    ['POST', () => projectIssuesBulkPath('tracked'), { ids: [ids.first], changes: {} }],
    ['POST', () => projectIssuesBulkPath('tracked'), { ids: [ids.first], changes: { title: 'x' } }],
    ['POST', () => projectIssueCommentsPath('tracked', ids.first), { text: '' }],
    ['PATCH', () => projectIssueCommentPath('tracked', ids.first, 'x\'y'), { text: 'x' }],
  ] as const)('answers 400 for %s %#', async (method, path, body) => {
    const res = await send(method, path(), body)
    expect(res.status).toBe(400)
    expect((await res.json() as ApiErrorBody).error.code).toBe('invalid_request')
  })
})
