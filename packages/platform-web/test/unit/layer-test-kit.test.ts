// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import ZetaPage from '../fixtures/zeta-layer/app/pages/p/[project]/zeta/index.vue'
import { layerApiError, layerComponents, layerRegistry, renderLayerPage, type LayerApi } from '../kit'

const RECORDS = { records: [{ id: 'r1', title: 'First record' }, { id: 'r2', title: 'Second record' }] }
const api: LayerApi = { 'GET /workspaces/acme/zeta': RECORDS }

describe('renderLayerPage', () => {
  it('renders the page inside the gate with the view granted, answering its daemon calls', async () => {
    const page = await renderLayerPage(ZetaPage, { api, registry: layerRegistry({ tools: ['zeta.manage'] }) })
    expect(page.gate()).toBe('ready')
    expect(page.findAll('[data-testid="zeta-record"]').map(record => record.text())).toEqual(['First record', 'Second record'])
    expect(page.byTestId('zeta-add').exists()).toBe(true)
    expect(page.calls).toEqual([
      { method: 'GET', path: '/workspaces' },
      { method: 'GET', path: '/organisations' },
      { method: 'GET', path: '/workspaces/acme/registry' },
      { method: 'GET', path: '/workspaces/acme/zeta' },
    ])
    page.unmount()
  })

  it('shows the lockout and no page content with the view denied', async () => {
    const page = await renderLayerPage(ZetaPage, { api, registry: layerRegistry({ access: 'denied' }) })
    expect(page.gate()).toBe('not-granted')
    expect(page.text()).toContain('Not available to you')
    expect(page.byTestId('zeta-records').exists()).toBe(false)
    expect(page.calls.map(call => call.path)).not.toContain('/workspaces/acme/zeta')
    page.unmount()
  })

  it('shows the configure state with the capability not ready, listing the reasons and the admin\'s actions', async () => {
    const reasons = [{ kind: 'plugin' as const, plugin: 'widgets', message: 'The Widgets plugin is not configured.' }]
    const page = await renderLayerPage(ZetaPage, { api, registry: layerRegistry({ access: 'not-ready', reasons }) })
    expect(page.gate()).toBe('not-ready')
    expect(page.text()).toContain('Zeta needs setup for this project')
    expect(page.text()).toContain('The Widgets plugin is not configured.')
    expect(page.find('[data-testid="view-lockout"] a').attributes('href')).toBe('/p/acme/setup/plugins')
    expect(page.byTestId('zeta-records').exists()).toBe(false)
    page.unmount()
  })

  it('shows the not-enabled state, and a failing registry request as an error', async () => {
    const disabled = await renderLayerPage(ZetaPage, { api, registry: layerRegistry({ access: 'not-enabled' }) })
    expect(disabled.gate()).toBe('not-enabled')
    disabled.unmount()

    const failing = await renderLayerPage(ZetaPage, { api, registry: null })
    expect(failing.gate()).toBe('error')
    failing.unmount()
  })

  it('re-reads a replaced registry', async () => {
    const page = await renderLayerPage(ZetaPage, { api, registry: layerRegistry({ access: 'denied' }) })
    expect(page.gate()).toBe('not-granted')
    await page.setRegistry(layerRegistry())
    expect(page.gate()).toBe('ready')
    expect(page.findAll('[data-testid="zeta-record"]')).toHaveLength(2)
    page.unmount()
  })

  it('hides what the rung does not grant and passes the slot props through', async () => {
    const page = await renderLayerPage(ZetaPage, { api, registry: layerRegistry({ rung: 'read', tools: [] }) })
    expect(page.byTestId('zeta-add').exists()).toBe(false)
    page.unmount()
  })

  it('lets a page act: a click posts, the answer refreshes the list and the toast is recorded', async () => {
    let records = { records: [] as { id: string, title: string }[] }
    const page = await renderLayerPage(ZetaPage, {
      registry: layerRegistry({ tools: ['zeta.manage'] }),
      api: (call) => {
        if (call.path !== '/workspaces/acme/zeta') return undefined
        if (call.method === 'POST') {
          records = { records: [{ id: 'r9', title: (call.body as { title: string }).title }] }
          return { record: records.records[0] }
        }
        return records
      },
    })
    expect(page.byTestId('zeta-empty').text()).toBe('No records in this project yet.')
    await page.byTestId('zeta-add').trigger('click')
    await page.flush()
    expect(page.findAll('[data-testid="zeta-record"]').map(record => record.text())).toEqual(['New record'])
    expect(page.toasts).toEqual([{ title: 'Record added' }])
    expect(page.calls.filter(call => call.method === 'POST')).toEqual([{ method: 'POST', path: '/workspaces/acme/zeta', body: { title: 'New record' } }])
    page.unmount()
  })

  it('rejects a call the test answers with an error, as the daemon would', async () => {
    const page = await renderLayerPage(ZetaPage, { api: { 'GET /workspaces/acme/zeta': () => { throw layerApiError('tracker_failed', 'bd is down', 502) } } })
    expect(page.gate()).toBe('ready')
    expect(page.byTestId('zeta-empty').exists()).toBe(true)
    expect(page.findAll('[data-testid="zeta-record"]')).toHaveLength(0)
    page.unmount()
  })

  it('serves #components with the layer\'s, the shell\'s and the stubbed names', async () => {
    const components = await import('#components' as string)
    expect(Object.keys(components)).toEqual(expect.arrayContaining(['ZetaRecords', 'LazyZetaRecords', 'CapabilityViewGate', 'OverviewCards', 'UButton', 'NuxtLink']))
    expect(components.ZetaRecords).toBe(layerComponents().ZetaRecords)
  })

  it('runs the layer\'s Nuxt plugins, so its project home card renders where the overview puts it', async () => {
    const OverviewCards = layerComponents().OverviewCards!
    const home = await renderLayerPage(OverviewCards, { api, props: { name: 'facts' } })
    expect(home.byTestId('zeta-card').text()).toBe('2 zeta records')
    home.unmount()

    const empty = await renderLayerPage(OverviewCards, { api: { 'GET /workspaces/acme/zeta': { records: [] } }, props: { name: 'facts' } })
    expect(empty.byTestId('zeta-card').exists()).toBe(false)
    empty.unmount()
  })
})
