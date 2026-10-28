import type { IssueDetail } from '@candy-mountain/shared'
import { describe, expect, it, vi } from 'vitest'
import type { BdRunner } from './bd-runner'
import { createDoltCommentEditor, type CommentEditor } from './comment-edit'
import { IssueError } from './errors'
import type { IssueProject, IssuesService } from './service'
import { createIssueWriter } from './writes'

const project: IssueProject = { id: 'p1', source: { kind: 'local-path', path: '/repo' } }

function fakeReads() {
  return {
    list: vi.fn(),
    show: vi.fn(async (_project: IssueProject, id: string) => ({ id }) as IssueDetail),
    dependencies: vi.fn(),
    comments: vi.fn(),
    invalidate: vi.fn(),
  } satisfies IssuesService
}

function setup(respond: (args: readonly string[]) => unknown, editComment: CommentEditor = vi.fn()) {
  const run = vi.fn<BdRunner>(async (_cwd, args) => {
    const value = respond(args)
    if (value instanceof Error) throw value
    return value
  })
  const reads = fakeReads()
  return { run, reads, writer: createIssueWriter({ run, reads, editComment }) }
}

describe('issue writer', () => {
  it('passes values as --flag=value with the actor last', async () => {
    const { run, writer } = setup(() => [{ id: 'x-1' }])
    await writer.update(project, 'x-1', { title: '--help', parentId: null, assignee: null, priority: 0 }, 'jack')
    expect(run).toHaveBeenCalledWith('/repo', ['update', 'x-1', '--priority=0', '--assignee=', '--parent=', '--title=--help', '--actor=jack'])
  })

  it('clears labels by removing each current one', async () => {
    const { run, writer } = setup(args => (args[0] === 'show' ? [{ id: 'x-1', labels: ['a', 'b'] }] : [{ id: 'x-1' }]))
    await writer.update(project, 'x-1', { labels: [] })
    expect(run).toHaveBeenLastCalledWith('/repo', ['update', 'x-1', '--remove-label=a', '--remove-label=b'])
  })

  it('invalidates the list even when bd fails', async () => {
    const { reads, writer } = setup(() => new IssueError('tracker_failed', 'boom'))
    await expect(writer.close(project, 'x-1', {})).rejects.toThrow('boom')
    expect(reads.invalidate).toHaveBeenCalledWith('p1')
  })

  it('updates many ids with one bd call and reports the ones bd skipped', async () => {
    const { run, reads, writer } = setup(() => [{ id: 'x-1' }, { id: 'x-3' }])
    const result = await writer.bulkUpdate(project, { ids: ['x-1', 'x-2', 'x-3'], changes: { status: 'closed', addLabels: ['l'] } })
    expect(result).toEqual({ updatedIds: ['x-1', 'x-3'], missingIds: ['x-2'] })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('/repo', ['update', 'x-1', 'x-2', 'x-3', '--status=closed', '--add-label=l'])
    expect(reads.invalidate).toHaveBeenCalledWith('p1')
  })

  it('reports every id missing when none resolve', async () => {
    const { writer } = setup(() => new IssueError('not_found', 'no issue found matching "x-9"'))
    expect(await writer.bulkUpdate(project, { ids: ['x-9'], changes: { priority: 1 } })).toEqual({ updatedIds: [], missingIds: ['x-9'] })
  })

  it('collects refused dependencies as warnings after creating', async () => {
    const { writer } = setup((args) => {
      if (args[0] === 'create') return { id: 'x-5' }
      if (args[3] === 'x-bad') return new IssueError('tracker_failed', 'epics can only block other epics')
      return { status: 'added' }
    })
    const result = await writer.create(project, { title: 'New', dependsOn: ['x-1', 'x-bad'] })
    expect(result).toEqual({ issue: { id: 'x-5' }, warnings: ['x-bad: epics can only block other epics'] })
  })

  it('edits a comment through the editor and returns what bd reads back', async () => {
    let text = 'old'
    const editComment = vi.fn<CommentEditor>(async (_cwd, edit) => { text = edit.text })
    const { writer } = setup(() => [{ id: 'c1', issue_id: 'x-1', author: 'a', text }], editComment)
    expect(await writer.editComment(project, 'x-1', 'c1', 'new', 'jack')).toMatchObject({ id: 'c1', text: 'new' })
    expect(editComment).toHaveBeenCalledWith('/repo', { issueId: 'x-1', commentId: 'c1', text: 'new', actor: 'jack' })
  })

  it('fails when the edited text does not read back', async () => {
    const { writer } = setup(() => [{ id: 'c1', issue_id: 'x-1', text: 'old' }])
    await expect(writer.editComment(project, 'x-1', 'c1', 'new')).rejects.toMatchObject({ code: 'tracker_failed' })
  })

  it('answers not_found for a comment the issue does not have', async () => {
    const editComment = vi.fn<CommentEditor>()
    const { writer } = setup(() => [{ id: 'c1', issue_id: 'x-1', text: 'old' }], editComment)
    await expect(writer.editComment(project, 'x-1', 'c2', 'new')).rejects.toMatchObject({ code: 'not_found' })
    expect(editComment).not.toHaveBeenCalled()
  })
})

describe('dolt comment editor', () => {
  it('refuses a workspace that is not on embedded Dolt', async () => {
    const run = vi.fn<BdRunner>(async () => ({ backend: 'dolt', embedded: false, database: 'x', data_dir: '/d' }))
    await expect(createDoltCommentEditor(run)('/repo', { issueId: 'x-1', commentId: 'c1', text: 't' }))
      .rejects.toMatchObject({ code: 'tracker_failed' })
  })
})
