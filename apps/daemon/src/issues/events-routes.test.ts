import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ISSUE_CHANGED_EVENT, PROJECTS_PATH, projectIssueEventsPath, projectIssuePath, type ApiErrorBody } from '@candy-mountain/shared'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, type AppEnv } from '../app'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { createProject } from '../projects'
import { openTestDatabase } from '../testing'
import { issueEventRoutes } from './events-routes'
import { createTempBeadsWorkspace, hasBd, type TempBeadsWorkspace } from './test-workspace'
import { startIssueWatcher, type IssueChangeListener, type IssueWatcher } from './watcher'

const execFileAsync = promisify(execFile)

function fakeWatcher() {
  const controller = new AbortController()
  const listeners = new Map<string, Set<IssueChangeListener>>()
  const watcher: IssueWatcher = {
    subscribe(projectId, listener) {
      const set = listeners.get(projectId) ?? new Set()
      listeners.set(projectId, set)
      set.add(listener)
      return () => set.delete(listener)
    },
    isWatching: () => true,
    reconcile: () => {},
    signal: controller.signal,
    close: () => controller.abort(),
  }
  const emit = (projectId: string) => listeners.get(projectId)?.forEach(listener => listener())
  const count = (projectId: string) => listeners.get(projectId)?.size ?? 0
  return { watcher, emit, count }
}

class StreamReader {
  text = ''
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private decoder = new TextDecoder()
  private pending: ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]> | null = null

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader()
  }

  /** Reads one chunk; resolves 'timeout' without losing a read that is still in flight. */
  private async next(timeoutMs: number): Promise<'data' | 'done' | 'timeout'> {
    this.pending ??= this.reader.read()
    const result = await Promise.race([
      this.pending,
      new Promise<null>(resolve => setTimeout(() => resolve(null), Math.max(0, timeoutMs))),
    ])
    if (result === null) return 'timeout'
    this.pending = null
    if (result.done) return 'done'
    this.text += this.decoder.decode(result.value, { stream: true })
    return 'data'
  }

  async until(fragment: string, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!this.text.includes(fragment)) {
      const outcome = await this.next(deadline - Date.now())
      if (outcome !== 'data') throw new Error(`Stream ${outcome} without ${JSON.stringify(fragment)}; got ${JSON.stringify(this.text)}`)
    }
  }

  async ended(timeoutMs = 2000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const outcome = await this.next(deadline - Date.now())
      if (outcome !== 'data') return outcome === 'done'
    }
  }

  cancel(): Promise<void> {
    return this.reader.cancel()
  }
}

describe('issue event stream', () => {
  let database: PlatformDatabase
  let projectId: string

  beforeEach(async () => {
    database = openTestDatabase()
    projectId = (await createProject(database.db, { name: 'Events', slug: 'events', source: { kind: 'local-path', path: process.cwd() } })).id
  })

  afterEach(() => database.close())

  function appWith(watcher: IssueWatcher, heartbeatMs?: number) {
    const app = new Hono<AppEnv>()
    app.use(async (c, next) => {
      c.set('db', database.db)
      await next()
    })
    app.route(PROJECTS_PATH, issueEventRoutes(watcher, { heartbeatMs }))
    return app
  }

  it('opens an SSE stream, relays changes as events and sends heartbeats', async () => {
    const { watcher, emit } = fakeWatcher()
    const res = await appWith(watcher, 50).request(projectIssueEventsPath('events'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')

    const stream = new StreamReader(res.body!)
    await stream.until(': connected\n\n')
    emit(projectId)
    await stream.until(`event: ${ISSUE_CHANGED_EVENT}\ndata: {"projectId":"${projectId}"}\n\n`)
    await stream.until(': ping\n\n')
    await stream.cancel()
  })

  it('subscribes once per connection and unsubscribes when the client goes away', async () => {
    const { watcher, count } = fakeWatcher()
    const app = appWith(watcher)
    const first = new StreamReader((await app.request(projectIssueEventsPath('events'))).body!)
    const second = new StreamReader((await app.request(projectIssueEventsPath('events'))).body!)
    await first.until(': connected')
    await second.until(': connected')
    expect(count(projectId)).toBe(2)

    await first.cancel()
    await expect.poll(() => count(projectId)).toBe(1)
    await second.cancel()
    await expect.poll(() => count(projectId)).toBe(0)
  })

  it('ends open streams when the watcher closes', async () => {
    const { watcher } = fakeWatcher()
    const stream = new StreamReader((await appWith(watcher).request(projectIssueEventsPath('events'))).body!)
    await stream.until(': connected')
    watcher.close()
    expect(await stream.ended()).toBe(true)
  })

  it('answers 404 for an unknown project', async () => {
    const res = await appWith(fakeWatcher().watcher).request(projectIssueEventsPath('nope'))
    expect(res.status).toBe(404)
    expect((await res.json() as ApiErrorBody).error.code).toBe('not_found')
  })

  it('is mounted by createApp ahead of the issue detail route', async () => {
    const { watcher } = fakeWatcher()
    const app = createApp({ db: database.db, paths: dataPaths('/unused'), issueWatcher: watcher })
    const res = await app.request(projectIssuePath('events', 'events'))
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    await res.body!.cancel()
  })
})

describe.skipIf(!hasBd)('issue event stream against a real workspace', () => {
  let workspace: TempBeadsWorkspace
  let database: PlatformDatabase
  let watcher: IssueWatcher

  beforeEach(async () => {
    workspace = createTempBeadsWorkspace('ev')
    database = openTestDatabase()
    await createProject(database.db, { name: 'Live', slug: 'live', source: { kind: 'local-path', path: workspace.path } })
    watcher = startIssueWatcher({ db: database.db })
  }, 30_000)

  afterEach(() => {
    watcher.close()
    database.close()
    workspace.cleanup()
  })

  it('emits changed on the stream when bd create runs in the checkout', async () => {
    const app = createApp({ db: database.db, paths: dataPaths('/unused'), issueWatcher: watcher })
    const stream = new StreamReader((await app.request(projectIssueEventsPath('live'))).body!)
    await stream.until(': connected')
    await new Promise(resolve => setTimeout(resolve, 200))

    const env: NodeJS.ProcessEnv = { ...process.env, BD_NON_INTERACTIVE: '1' }
    delete env.BEADS_DIR
    delete env.BEADS_DB
    await execFileAsync('bd', ['create', '--title', 'Streamed'], { cwd: workspace.path, env })
    await stream.until(`event: ${ISSUE_CHANGED_EVENT}\n`, 2000)
    await stream.cancel()
  }, 15_000)
})
