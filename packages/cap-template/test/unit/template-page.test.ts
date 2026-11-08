// @vitest-environment happy-dom
import { layerComponents, layerRegistry, renderLayerPage } from '@candy-mountain/platform-web/test'
import { describe, expect, it } from 'vitest'
import TemplatePage from '../../app/pages/p/[project]/template/index.vue'

const note = (id: string, text: string) => ({ id, workspaceId: 'w1', text, createdAt: '2026-01-01T00:00:00.000Z' })
const NOTES_PATH = '/workspaces/acme/template/notes'
const api = { [`GET ${NOTES_PATH}`]: { notes: [note('n1', 'First'), note('n2', 'Second')] } }

describe('template page', () => {
  it('lists the notes and offers the create form when the view and the tool are granted', async () => {
    const page = await renderLayerPage(TemplatePage, { api, registry: layerRegistry({ rung: 'manage', tools: ['template.manage'] }) })
    expect(page.gate()).toBe('ready')
    expect(page.findAll('[data-testid="template-note"]').map(item => item.text())).toEqual(['First', 'Second'])
    expect(page.byTestId('template-note-form').exists()).toBe(true)
    page.unmount()
  })

  it('posts a note and shows it once the list refreshes', async () => {
    const notes = [note('n1', 'First')]
    const page = await renderLayerPage(TemplatePage, {
      registry: layerRegistry({ rung: 'manage', tools: ['template.manage'] }),
      api: (call) => {
        if (call.path !== NOTES_PATH) return undefined
        if (call.method === 'POST') {
          notes.push(note('n2', (call.body as { text: string }).text))
          return { note: notes.at(-1) }
        }
        return { notes: [...notes] }
      },
    })
    await page.byTestId('template-note-text').setValue('Second')
    await page.byTestId('template-note-form').trigger('submit')
    await page.flush()
    expect(page.calls.filter(call => call.method === 'POST')).toEqual([{ method: 'POST', path: NOTES_PATH, body: { text: 'Second' } }])
    expect(page.findAll('[data-testid="template-note"]').map(item => item.text())).toEqual(['First', 'Second'])
    page.unmount()
  })

  it('hides the create form from a reader', async () => {
    const page = await renderLayerPage(TemplatePage, { api, registry: layerRegistry({ rung: 'read', tools: [] }) })
    expect(page.findAll('[data-testid="template-note"]')).toHaveLength(2)
    expect(page.byTestId('template-note-form').exists()).toBe(false)
    page.unmount()
  })

  it('locks the page and fetches no notes when the view is denied', async () => {
    const page = await renderLayerPage(TemplatePage, { api, registry: layerRegistry({ access: 'denied' }) })
    expect(page.gate()).toBe('not-granted')
    expect(page.byTestId('template-note').exists()).toBe(false)
    expect(page.calls.map(call => call.path)).not.toContain(NOTES_PATH)
    page.unmount()
  })
})

describe('template overview card', () => {
  const renderHome = (options: Parameters<typeof renderLayerPage>[1]) =>
    renderLayerPage(layerComponents().OverviewCards!, { ...options, props: { name: 'aside' } })

  it('shows the note count', async () => {
    const home = await renderHome({ api })
    expect(home.byTestId('template-card').text()).toContain('2 notes')
    home.unmount()
  })

  it('renders nothing when there are no notes', async () => {
    const home = await renderHome({ api: { [`GET ${NOTES_PATH}`]: { notes: [] } } })
    expect(home.byTestId('template-card').exists()).toBe(false)
    home.unmount()
  })

  it('renders nothing and asks nothing when the actor cannot see the notes', async () => {
    const home = await renderHome({ api, registry: layerRegistry({ access: 'denied' }) })
    expect(home.byTestId('template-card').exists()).toBe(false)
    expect(home.calls.map(call => call.path)).not.toContain(NOTES_PATH)
    home.unmount()
  })
})
