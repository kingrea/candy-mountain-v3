import { ACTIVITY_TYPES_PATH, type ActivityEventTypesResponse, type ActivityListResponse, type CrossWorkspaceActivityResponse, type ApiErrorBody, type Workspace } from '@candy-mountain/platform-sdk'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, openTestDatabase } from '../testing'
import { fixtureDefinition } from '../capabilities/fixtures'
import { dataPaths } from '../data-dir'
import { openDatabase, type PlatformDatabase } from '../db'
import { archiveWorkspace, createWorkspace, deleteWorkspace } from '../workspaces/workspaces'
import { ActivityError } from './errors'
import { activityEvents } from '../db/schema'
import { ACTIVITY_PAYLOAD_MAX_BYTES, appendActivityEvent, listActivityEvents, type ListActivityOptions } from './events'

/** The product-looking types the cases append, declared by one fixture after the platform's own. */
const ops = fixtureDefinition('ops', { activityEventTypes: [
  { id: 'bot.handoff', label: 'Bot handoff', icon: 'i-lucide-hand' },
  { id: 'incident.opened', label: 'Incident opened', icon: 'i-lucide-triangle-alert' },
  { id: 'incident.closed', label: 'Incident closed', icon: 'i-lucide-check' },
  { id: 'deploy.attempted', label: 'Deploy attempted', icon: 'i-lucide-rocket' },
] })

let database: PlatformDatabase
beforeEach(() => {
  database = openTestDatabase({ definitions: [ops] })
})
afterEach(() => database.close())

const workspace = async (name: string): Promise<Workspace> => createWorkspace(database.db, { name })
const app = () => createTestApp({ db: database.db, paths: dataPaths('/unused') })

describe('activity events', () => {
  it('appends and lists with link and payload', async () => {
    const alpha = await workspace('alpha')
    const event = appendActivityEvent(database.db, { workspaceId: alpha.id, type: 'run.started', title: 'Run started', link: '/p/alpha/runs/1', payload: { issues: ['a-1'] } })
    expect(listActivityEvents(database.db, alpha.id).events).toEqual([event])
    expect(event).toMatchObject({ link: '/p/alpha/runs/1', payload: { issues: ['a-1'] } })
    const bare = appendActivityEvent(database.db, { workspaceId: alpha.id, type: 'session.started', title: 'x' })
    expect(bare).toMatchObject({ link: null, payload: null })
  })

  it('lists newest first, per workspace, filtered by type', async () => {
    const [alpha, beta] = [await workspace('alpha'), await workspace('beta')]
    for (const [i, type] of (['session.started', 'run.started', 'session.started'] as const).entries()) {
      appendActivityEvent(database.db, { workspaceId: alpha.id, type, title: `e${i}` })
    }
    appendActivityEvent(database.db, { workspaceId: beta.id, type: 'deploy.attempted', title: 'other' })
    expect(listActivityEvents(database.db, alpha.id).events.map(e => e.title)).toEqual(['e2', 'e1', 'e0'])
    expect(listActivityEvents(database.db, alpha.id, { types: ['session.started'] }).events.map(e => e.title)).toEqual(['e2', 'e0'])
  })

  it('filters by several types and by since', async () => {
    const alpha = await workspace('alpha')
    const types = ['run.started', 'incident.opened', 'incident.closed', 'deploy.attempted'] as const
    for (const [i, type] of types.entries()) appendActivityEvent(database.db, { workspaceId: alpha.id, type, title: `e${i}` })
    database.db.update(activityEvents).set({ occurredAt: '2020-01-01T00:00:00.000Z' }).where(eq(activityEvents.title, 'e1')).run()
    const titles = (options: ListActivityOptions) => listActivityEvents(database.db, alpha.id, options).events.map(e => e.title)
    expect(titles({ types: ['incident.opened', 'incident.closed'] })).toEqual(['e2', 'e1'])
    expect(titles({ since: '2021-01-01T00:00:00.000Z' })).toEqual(['e3', 'e2', 'e0'])
    expect(titles({ since: '2021-01-01T00:00:00.000Z', types: ['incident.opened', 'incident.closed'] })).toEqual(['e2'])
  })

  it('pages with a cursor, including events in the same millisecond', async () => {
    const alpha = await workspace('alpha')
    for (let i = 0; i < 5; i++) appendActivityEvent(database.db, { workspaceId: alpha.id, type: 'bot.handoff', title: `e${i}` })
    const first = listActivityEvents(database.db, alpha.id, { limit: 2 })
    expect(first.events.map(e => e.title)).toEqual(['e4', 'e3'])
    const second = listActivityEvents(database.db, alpha.id, { limit: 2, before: first.nextCursor! })
    expect(second.events.map(e => e.title)).toEqual(['e2', 'e1'])
    const third = listActivityEvents(database.db, alpha.id, { limit: 2, before: second.nextCursor! })
    expect(third.events.map(e => e.title)).toEqual(['e0'])
    expect(third.nextCursor).toBeNull()
  })

  it('rejects oversized payloads', async () => {
    const alpha = await workspace('alpha')
    const big = { text: 'x'.repeat(ACTIVITY_PAYLOAD_MAX_BYTES) }
    expect(() => appendActivityEvent(database.db, { workspaceId: alpha.id, type: 'run.started', title: 't', payload: big })).toThrow(ActivityError)
    expect(listActivityEvents(database.db, alpha.id).events).toEqual([])
  })

  it('cascades on workspace delete', async () => {
    const alpha = await workspace('alpha')
    appendActivityEvent(database.db, { workspaceId: alpha.id, type: 'run.started', title: 't' })
    deleteWorkspace(database.db, 'alpha')
    expect(listActivityEvents(database.db, alpha.id).events).toEqual([])
  })
})

describe('GET /workspaces/:slug/activity', () => {
  it('lists, filters and pages over HTTP', async () => {
    const alpha = await workspace('alpha')
    for (let i = 0; i < 3; i++) appendActivityEvent(database.db, { workspaceId: alpha.id, type: i === 1 ? 'incident.opened' : 'deploy.attempted', title: `e${i}` })
    const first = await (await app().request('/workspaces/alpha/activity?limit=2')).json() as ActivityListResponse
    expect(first.events.map(e => e.title)).toEqual(['e2', 'e1'])
    const next = await (await app().request(`/workspaces/alpha/activity?limit=2&before=${first.nextCursor}`)).json() as ActivityListResponse
    expect(next.events.map(e => e.title)).toEqual(['e0'])
    const filtered = await (await app().request('/workspaces/alpha/activity?type=incident.opened')).json() as ActivityListResponse
    expect(filtered.events.map(e => e.title)).toEqual(['e1'])
    const multi = await (await app().request('/workspaces/alpha/activity?type=incident.opened,deploy.attempted&since=2000-01-01T00:00:00Z')).json() as ActivityListResponse
    expect(multi.events).toHaveLength(3)
    const future = await (await app().request('/workspaces/alpha/activity?since=2999-01-01T00:00:00Z')).json() as ActivityListResponse
    expect(future.events).toEqual([])
  })

  it('validates the query and the workspace', async () => {
    await workspace('alpha')
    for (const query of ['type=nope', 'type=run.started,nope', 'since=yesterday', 'limit=0', 'limit=abc', 'before=!!']) {
      const res = await app().request(`/workspaces/alpha/activity?${query}`)
      expect(res.status).toBe(400)
      expect(((await res.json()) as ApiErrorBody).error.code).toBe('invalid_request')
    }
    expect((await app().request('/workspaces/missing/activity')).status).toBe(404)
  })

  it('has no route that creates events', async () => {
    await workspace('alpha')
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await app().request('/workspaces/alpha/activity', { method, headers: { 'content-type': 'application/json' }, body: '{}' })
      expect(res.status).toBeGreaterThanOrEqual(404)
    }
  })

  it('lists across non-archived workspaces with workspace labels, filters and paging', async () => {
    const [alpha, beta, gone] = [await workspace('alpha'), await workspace('beta'), await workspace('gone')]
    appendActivityEvent(database.db, { workspaceId: alpha.id, type: 'run.started', title: 'a1', link: '/p/alpha/runs' })
    appendActivityEvent(database.db, { workspaceId: beta.id, type: 'deploy.attempted', title: 'b1' })
    appendActivityEvent(database.db, { workspaceId: gone.id, type: 'run.started', title: 'g1' })
    appendActivityEvent(database.db, { workspaceId: alpha.id, type: 'run.started', title: 'a2' })
    archiveWorkspace(database.db, 'gone')
    const get = async (query = '') => await (await app().request(`/activity${query}`)).json() as CrossWorkspaceActivityResponse
    const all = await get()
    expect(all.events.map(e => e.title)).toEqual(['a2', 'b1', 'a1'])
    expect(all.events[1]!.workspace).toEqual({ slug: 'beta', name: 'beta', color: beta.color })
    expect((await get('?type=deploy.attempted')).events.map(e => e.title)).toEqual(['b1'])
    const first = await get('?limit=2')
    expect((await get(`?limit=2&before=${first.nextCursor}`)).events.map(e => e.title)).toEqual(['a1'])
    expect((await app().request('/activity?type=nope')).status).toBe(400)
  })
})

describe('activity event types', () => {
  it('serves the registered types with labels and icons in declaration order', async () => {
    const res = await app().request(ACTIVITY_TYPES_PATH)
    expect(res.status).toBe(200)
    const { types } = await res.json() as ActivityEventTypesResponse
    expect(types.map(t => t.id)).toEqual(['session.started', 'run.started', 'bot.handoff', 'incident.opened', 'incident.closed', 'deploy.attempted'])
    expect(types[3]).toEqual({ id: 'incident.opened', label: 'Incident opened', icon: 'i-lucide-triangle-alert' })
  })

  it('refuses appends on a database nothing registered types for', async () => {
    const bare = openDatabase(':memory:')
    try {
      expect(() => appendActivityEvent(bare.db, { workspaceId: 'p', type: 'run.started', title: 'x' })).toThrow("Activity event type 'run.started' is not registered.")
    }
    finally {
      bare.close()
    }
  })
})
