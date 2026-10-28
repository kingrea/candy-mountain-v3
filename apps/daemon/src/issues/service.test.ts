import { describe, expect, it, vi } from 'vitest'
import type { BdRunner } from './bd-runner'
import { IssueError } from './errors'
import { createIssuesService, type IssueProject } from './service'

const project: IssueProject = { id: 'p1', source: { kind: 'local-path', path: '/repo' } }

const listRows = [
  { id: 'x-1', title: 'Epic', status: 'open', priority: 1, issue_type: 'epic' },
  {
    id: 'x-1.1',
    title: 'Child',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    parent: 'x-1',
    labels: ['stage:build'],
    comment_count: 2,
    dependencies: [{ issue_id: 'x-1.1', depends_on_id: 'x-1', type: 'parent-child', created_at: 't', metadata: '{}' }],
  },
  { id: 'x-2', title: 'Done', status: 'closed', priority: 3, issue_type: 'bug', closed_at: 't', close_reason: 'shipped' },
]

function fakeRunner(overrides: Record<string, unknown> = {}) {
  return vi.fn<BdRunner>(async (_cwd, args) => {
    const key = args.join(' ')
    if (key in overrides) {
      const value = overrides[key]
      if (value instanceof Error) throw value
      return value
    }
    if (args[0] === 'list') return listRows
    if (args[0] === 'ready') return [listRows[1]]
    throw new Error(`unexpected bd ${key}`)
  })
}

const listCalls = (run: ReturnType<typeof fakeRunner>) => run.mock.calls.filter(([, args]) => args[0] === 'list').length

describe('issue list cache', () => {
  it('runs bd once for two lists inside the cache window', async () => {
    let clock = 0
    const run = fakeRunner()
    const service = createIssuesService({ run, ttlMs: 3000, now: () => clock })

    await service.list(project)
    clock = 2999
    await service.list(project)
    expect(listCalls(run)).toBe(1)

    clock = 6000
    await service.list(project)
    expect(listCalls(run)).toBe(2)
  })

  it('shares one in-flight load between concurrent callers', async () => {
    const run = fakeRunner()
    const service = createIssuesService({ run })
    await Promise.all([service.list(project), service.list(project), service.list(project)])
    expect(listCalls(run)).toBe(1)
  })

  it('reloads after invalidation and when the checkout path changes', async () => {
    const run = fakeRunner()
    const service = createIssuesService({ run })
    await service.list(project)
    service.invalidate(project.id)
    await service.list(project)
    expect(listCalls(run)).toBe(2)

    await service.list({ ...project, source: { kind: 'local-path', path: '/moved' } })
    expect(listCalls(run)).toBe(3)
    expect(run.mock.calls.at(-1)?.[0]).toBe('/moved')
  })

  it('does not cache a failed load', async () => {
    const run = fakeRunner({ 'list --all --limit 0': new IssueError('tracker_failed', 'locked') })
    const service = createIssuesService({ run })
    await expect(service.list(project)).rejects.toThrow('locked')
    run.mockImplementation(fakeRunner())
    await expect(service.list(project)).resolves.toHaveLength(3)
  })

  it('keeps caches per project', async () => {
    const run = fakeRunner()
    const service = createIssuesService({ run })
    await service.list(project)
    await service.list({ id: 'p2', source: { kind: 'local-path', path: '/other' } })
    expect(listCalls(run)).toBe(2)
  })
})

describe('issue mapping', () => {
  it('lists every issue with readiness from bd ready', async () => {
    const run = fakeRunner()
    const issues = await createIssuesService({ run }).list(project)
    expect(run.mock.calls.map(([cwd, args]) => [cwd, args.join(' ')])).toEqual([
      ['/repo', 'list --all --limit 0'],
      ['/repo', 'ready --limit 0'],
    ])
    expect(issues.map(issue => [issue.id, issue.ready])).toEqual([['x-1', false], ['x-1.1', true], ['x-2', false]])
    expect(issues[1]).toMatchObject({
      type: 'task',
      parentId: 'x-1',
      labels: ['stage:build'],
      commentCount: 2,
      description: null,
      dependencies: [{ issueId: 'x-1.1', dependsOnId: 'x-1', type: 'parent-child' }],
    })
    expect(issues[2]).toMatchObject({ status: 'closed', closeReason: 'shipped', dependencies: [] })
  })

  it('answers not_found when bd show prints nothing', async () => {
    const run = fakeRunner({ 'show x-9': [], 'dep list x-9 --direction up': [] })
    const error = await createIssuesService({ run }).show(project, 'x-9').catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'not_found', status: 404 })
  })

  it('normalises both shapes bd dep list prints', async () => {
    const neighbour = { id: 'x-1', title: 'Epic', status: 'open', priority: 1, issue_type: 'epic', dependency_type: 'parent-child' }
    const run = fakeRunner({
      'dep list x-1.1': [neighbour],
      'dep list x-1.1 x-2': [{ issue_id: 'x-1.1', depends_on_id: 'x-1', type: 'parent-child' }],
      'dep list x-1.1 x-404': [neighbour],
      'dep list x-404': new IssueError('not_found', 'no issue found matching "x-404"'),
    })
    const service = createIssuesService({ run })
    const edge = { issueId: 'x-1.1', dependsOnId: 'x-1', type: 'parent-child' }
    expect(await service.dependencies(project, ['x-1.1'])).toEqual([edge])
    expect(await service.dependencies(project, ['x-1.1', 'x-2'])).toEqual([edge])
    expect(await service.dependencies(project, ['x-1.1', 'x-404', 'x-1.1'])).toEqual([edge])
    expect(await service.dependencies(project, ['x-404'])).toEqual([])
  })
})
