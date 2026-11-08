import { WORKSPACES_PATH, workspaceViewRoute, type ActivityListResponse, type ApiErrorBody } from '@candy-mountain/platform-sdk'
import { testKit, type TestKit } from '@candy-mountain/platform-daemon/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEMPLATE_TICKER, templateDefinition } from './definition'
import { NOTE_CREATED_EVENT } from './notes'
import { workspaceTemplateNotesPath, type TemplateNoteListResponse, type TemplateNoteResponse } from './wire'

let kit: TestKit | undefined
afterEach(async () => {
  await kit?.close()
  kit = undefined
})

const start = (tickIntervalMs?: number) => (kit = testKit({ capabilities: [templateDefinition({ tickIntervalMs })] }))
const errorCode = async (res: Response) => ((await res.json()) as ApiErrorBody).error.code
const post = (text: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })

describe('the template definition', () => {
  it('boots with its table, fact and event type registered', () => {
    const { platform } = start()
    expect(platform.capabilities.list().map(cap => cap.id)).toEqual(['template'])
    expect(platform.migrationSets.map(set => set.id)).toEqual(['platform', 'template'])
    expect(platform.workspaceFacts.has('hasTemplateNotes')).toBe(true)
    expect(platform.activityEventTypes.has(NOTE_CREATED_EVENT)).toBe(true)
  })

  it('lists notes to an actor at read and refuses one below it', async () => {
    const kit = start()
    const { slug } = kit.workspace()
    const path = workspaceTemplateNotesPath(slug)

    const refused = await kit.actor().request(path)
    expect(refused.status).toBe(403)
    expect(await errorCode(refused)).toBe('not_granted')

    const listed = await kit.actor({ rungs: { template: 'read' } }).request(path)
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual<TemplateNoteListResponse>({ notes: [] })
  })

  it('creates a note only at manage, appending the event and setting the fact', async () => {
    const kit = start()
    const workspace = kit.workspace()
    const path = workspaceTemplateNotesPath(workspace.slug)
    const hasNotes = () => kit.platform.workspaceFacts.compute(kit.db, workspace).hasTemplateNotes

    const reader = kit.actor({ rungs: { template: 'read' } })
    expect((await reader.request(path, post('no'))).status).toBe(403)
    expect(hasNotes()).toBe(false)

    const manager = kit.actor({ rungs: { template: 'manage' } })
    expect(await errorCode(await manager.request(path, post('  ')))).toBe('invalid_request')
    const created = await manager.request(path, post('First note'))
    expect(created.status).toBe(201)
    const { note } = (await created.json()) as TemplateNoteResponse
    expect(note).toMatchObject({ workspaceId: workspace.id, text: 'First note' })
    expect(hasNotes()).toBe(true)

    expect(await (await reader.request(path)).json()).toEqual<TemplateNoteListResponse>({ notes: [note] })
    const activity = (await (await reader.request(`${WORKSPACES_PATH}/${workspace.slug}/activity`)).json()) as ActivityListResponse
    expect(activity.events).toEqual([expect.objectContaining({ type: NOTE_CREATED_EVENT, link: workspaceViewRoute(kit.platform.product.config.scope.urlPrefix, workspace.slug, 'template'), payload: { noteId: note.id } })])
  })

  it('starts its ticker and stops it on close', async () => {
    const kit = start(5)
    const ticker = kit.platform.runtime.service(TEMPLATE_TICKER)!
    expect(ticker.running).toBe(true)
    await vi.waitFor(() => expect(ticker.ticks).toBeGreaterThan(0))

    await kit.close()
    expect(ticker.running).toBe(false)
  })
})
