import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  BulkIssueChanges,
  BulkUpdateIssuesRequest,
  BulkUpdateIssuesResponse,
  CloseIssueRequest,
  CreateIssueRequest,
  CreateIssueResponse,
  IssueComment,
  IssueDetail,
  UpdateIssueRequest,
} from '@candy-mountain/shared'
import { sourcePath } from '../projects'
import { runBd, type BdRunner } from './bd-runner'
import { editCommentInDolt, type CommentEditor } from './comment-edit'
import { IssueError } from './errors'
import { asArray, toComment } from './mapping'
import { issuesService, type IssueProject, type IssuesService } from './service'

/** Every write goes through bd and drops the project's cached list, even when it fails part way. */
export interface IssueWriter {
  create(project: IssueProject, request: CreateIssueRequest, actor?: string): Promise<CreateIssueResponse>
  update(project: IssueProject, id: string, request: UpdateIssueRequest, actor?: string): Promise<IssueDetail>
  close(project: IssueProject, id: string, request: CloseIssueRequest, actor?: string): Promise<IssueDetail>
  /** One bd invocation for all ids; ids bd does not know are reported, not fatal. */
  bulkUpdate(project: IssueProject, request: BulkUpdateIssuesRequest, actor?: string): Promise<BulkUpdateIssuesResponse>
  addComment(project: IssueProject, id: string, text: string, actor?: string): Promise<IssueComment>
  editComment(project: IssueProject, id: string, commentId: string, text: string, actor?: string): Promise<IssueComment>
}

export interface IssueWriterOptions {
  run?: BdRunner
  reads?: IssuesService
  editComment?: CommentEditor
}

// Values are always passed as --flag=value so text starting with a dash is never read as a flag.
const flag = (name: string, value: string | number) => `--${name}=${value}`
const actorFlags = (actor?: string) => (actor ? [flag('actor', actor)] : [])

function sharedFlags(changes: Pick<BulkIssueChanges, 'status' | 'priority' | 'type' | 'assignee' | 'parentId'>): string[] {
  const flags: string[] = []
  if (changes.status !== undefined) flags.push(flag('status', changes.status))
  if (changes.priority !== undefined) flags.push(flag('priority', changes.priority))
  if (changes.type !== undefined) flags.push(flag('type', changes.type))
  if (changes.assignee !== undefined) flags.push(flag('assignee', changes.assignee ?? ''))
  // bd detaches the issue from its parent when --parent is empty.
  if (changes.parentId !== undefined) flags.push(flag('parent', changes.parentId ?? ''))
  return flags
}

function returnedIds(payload: unknown, command: string): Set<string> {
  return new Set(asArray(payload, command).map(row => String(row.id)))
}

export function createIssueWriter(options: IssueWriterOptions = {}): IssueWriter {
  const run = options.run ?? runBd
  const reads = options.reads ?? issuesService
  const editStoredComment = options.editComment ?? editCommentInDolt

  async function write<T>(project: IssueProject, work: (cwd: string) => Promise<T>): Promise<T> {
    try {
      return await work(sourcePath(project.source))
    }
    finally {
      reads.invalidate(project.id)
    }
  }

  async function currentLabels(cwd: string, id: string): Promise<string[]> {
    const row = asArray(await run(cwd, ['show', id]), 'bd show')[0]
    if (!row) throw new IssueError('not_found', `No issue found matching ${id}`)
    return Array.isArray(row.labels) ? row.labels.filter((label): label is string => typeof label === 'string') : []
  }

  async function findComment(cwd: string, id: string, commentId: string): Promise<IssueComment | undefined> {
    return asArray(await run(cwd, ['comments', id]), 'bd comments').map(toComment).find(comment => comment.id === commentId)
  }

  return {
    async create(project, request, actor) {
      const warnings: string[] = []
      const id = await write(project, async (cwd) => {
        const args = ['create', flag('title', request.title), ...sharedFlags({
          type: request.type,
          priority: request.priority,
          assignee: request.assignee || undefined,
          parentId: request.parentId || undefined,
        })]
        if (request.labels?.length) args.push(flag('labels', request.labels.join(',')))
        if (request.description) args.push(flag('description', request.description))
        if (request.acceptanceCriteria) args.push(flag('acceptance', request.acceptanceCriteria))
        if (request.notes) args.push(flag('notes', request.notes))
        const created = await run(cwd, [...args, ...actorFlags(actor)]) as { id?: unknown } | null
        if (typeof created?.id !== 'string') throw new IssueError('tracker_failed', 'bd create did not report the new issue id')

        // bd create only warns when a --deps edge is refused, so edges are added one by one to surface why.
        for (const dependsOnId of request.dependsOn ?? []) {
          try {
            await run(cwd, ['dep', 'add', created.id, dependsOnId, ...actorFlags(actor)])
          }
          catch (error) {
            if (!(error instanceof IssueError)) throw error
            warnings.push(`${dependsOnId}: ${error.message}`)
          }
        }
        return created.id
      })
      return { issue: await reads.show(project, id), warnings }
    },

    async update(project, id, request, actor) {
      await write(project, async (cwd) => {
        const flags = sharedFlags(request)
        if (request.title !== undefined) flags.push(flag('title', request.title))
        if (request.description !== undefined) flags.push(flag('description', request.description ?? ''))
        if (request.acceptanceCriteria !== undefined) flags.push(flag('acceptance', request.acceptanceCriteria ?? ''))
        if (request.notes !== undefined) flags.push(flag('notes', request.notes ?? ''))
        if (request.labels?.length) flags.push(...request.labels.map(label => flag('set-labels', label)))
        // bd ignores an empty --set-labels, so clearing removes each current label instead.
        else if (request.labels) flags.push(...(await currentLabels(cwd, id)).map(label => flag('remove-label', label)))
        if (flags.length === 0) return

        const updated = returnedIds(await run(cwd, ['update', id, ...flags, ...actorFlags(actor)]), 'bd update')
        if (!updated.has(id)) throw new IssueError('not_found', `No issue found matching ${id}`)
      })
      return reads.show(project, id)
    },

    async close(project, id, request, actor) {
      await write(project, async (cwd) => {
        const args = ['close', id]
        if (request.reason) args.push(flag('reason', request.reason))
        if (request.force) args.push('--force')
        const closed = returnedIds(await run(cwd, [...args, ...actorFlags(actor)]), 'bd close')
        if (!closed.has(id)) throw new IssueError('not_found', `No issue found matching ${id}`)
      })
      return reads.show(project, id)
    },

    async bulkUpdate(project, { ids, changes }, actor) {
      return write(project, async (cwd) => {
        const flags = [
          ...sharedFlags(changes),
          ...(changes.addLabels ?? []).map(label => flag('add-label', label)),
          ...(changes.removeLabels ?? []).map(label => flag('remove-label', label)),
        ]
        let updated: Set<string>
        try {
          updated = returnedIds(await run(cwd, ['update', ...ids, ...flags, ...actorFlags(actor)]), 'bd update')
        }
        catch (error) {
          // bd skips unknown ids with a warning and only fails when none of them resolved.
          if (error instanceof IssueError && error.code === 'not_found') return { updatedIds: [], missingIds: ids }
          throw error
        }
        return { updatedIds: ids.filter(id => updated.has(id)), missingIds: ids.filter(id => !updated.has(id)) }
      })
    },

    async addComment(project, id, text, actor) {
      return write(project, async (cwd) => {
        // Comment text is positional in bd, so it goes through a file to keep a leading dash from reading as a flag.
        const directory = await mkdtemp(join(tmpdir(), 'candy-mountain-comment-'))
        try {
          const file = join(directory, 'comment.md')
          await writeFile(file, text, 'utf8')
          const added = await run(cwd, ['comments', 'add', id, '-f', file, ...actorFlags(actor)])
          if (typeof added !== 'object' || added === null) throw new IssueError('tracker_failed', 'bd comments add returned an unexpected shape')
          return toComment(added as Record<string, unknown>)
        }
        finally {
          await rm(directory, { recursive: true, force: true })
        }
      })
    },

    async editComment(project, id, commentId, text, actor) {
      return write(project, async (cwd) => {
        const existing = await findComment(cwd, id, commentId)
        if (!existing) throw new IssueError('not_found', `No comment ${commentId} on ${id}`)
        if (existing.text === text) return existing

        await editStoredComment(cwd, { issueId: id, commentId, text, actor })
        const saved = await findComment(cwd, id, commentId)
        if (saved?.text !== text) throw new IssueError('tracker_failed', `The edit to comment ${commentId} did not persist`)
        return saved
      })
    },
  }
}

export const issueWriter = createIssueWriter()
