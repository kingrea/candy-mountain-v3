import type { ModuleId, ReadinessReason, RegistryCapability, RegistryResponse, RegistryView, Workspace } from '@candy-mountain/platform-sdk'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h as render, nextTick, type Component } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import * as layer from './layer-manifest'
import {
  activate,
  createNuxtApp,
  deactivate,
  defineAsyncComponent,
  HARNESS,
  layerApiError,
  loading,
  type Harness,
  type LayerApi,
  type LayerApiCall,
  type LayerOverlayAnswer,
  type LayerToast,
} from './nuxt-app'
import { nuxtComponents, uiStub } from './ui'

export { layerApiError }
export type { LayerApi, LayerApiCall, LayerOverlayAnswer, LayerToast }

export type LayerViewAccess = 'granted' | 'denied' | 'not-ready' | 'not-enabled'

export interface LayerRegistryOptions {
  /** The capability id; the layer's own id by default. */
  capability?: string
  label?: string
  /** The manifest view id; the capability id by default. */
  view?: string
  /** The view's path relative to the workspace; the view id by default. */
  path?: string
  /** The actor's rung on the capability. */
  rung?: string
  /** Tool ids the rung grants. */
  tools?: string[]
  chat?: boolean
  /**
   * `granted`: the view is shown and ready. `denied`: the capability is held but the rung hides the view.
   * `not-ready`: the view is shown but the capability's readiness reasons lock it. `not-enabled`: no enabled module carries the capability.
   */
  access?: LayerViewAccess
  /** Why the capability is not ready; one plugin reason by default, and empty for a non-admin as the daemon answers. */
  reasons?: ReadinessReason[]
  admin?: boolean
  modules?: ModuleId[]
  workspace?: RegistryResponse['workspace']
}

export const DEFAULT_WORKSPACE: Workspace = {
  id: 'workspace-1',
  slug: 'acme',
  name: 'Acme',
  color: '#ec4899',
  organisationId: null,
  archived: false,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

/** The daemon's registry answer for one actor and one workspace, built for one capability's view in the chosen state. */
export function layerRegistry(options: LayerRegistryOptions = {}): RegistryResponse {
  const capability = options.capability ?? layer.id
  const label = options.label ?? layer.prefix
  const viewId = options.view ?? capability
  const path = options.path ?? viewId
  const access = options.access ?? 'granted'
  const admin = options.admin ?? true
  const workspace = options.workspace ?? { id: DEFAULT_WORKSPACE.id, slug: DEFAULT_WORKSPACE.slug, name: DEFAULT_WORKSPACE.name }
  const ready = access !== 'not-ready'
  const reasons = ready || !admin ? [] : options.reasons ?? [{ kind: 'plugin', plugin: capability, message: `The ${label} plugin is not configured for this ${layer.product.scope.label.singular}.` }]
  const to = `/${layer.product.scope.urlPrefix}/${workspace.slug}${path ? `/${path}` : ''}`

  const view: RegistryView = { id: viewId, capabilityId: capability, label, icon: 'i-lucide-box', path, to, ready }
  const held: RegistryCapability = {
    id: capability,
    label,
    rung: options.rung ?? 'manage',
    chat: options.chat ?? false,
    ready,
    reasons,
    modules: options.modules ?? [],
    views: access === 'denied' ? [] : [viewId],
    tools: options.tools ?? [],
  }
  const shown = access === 'granted' || access === 'not-ready'
  return {
    workspace,
    admin,
    modules: options.modules ?? [],
    groups: shown
      ? [{ id: capability, label, icon: 'i-lucide-box', kind: 'capability', entries: [{ id: viewId, label, icon: view.icon, to }], degraded: !ready && admin }]
      : [],
    views: shown ? [view] : [],
    agents: [],
    capabilities: access === 'not-enabled' ? [] : [held],
    degraded: [],
  }
}

export interface RenderLayerPageOptions {
  /** The daemon's registry answer; the layer's own view granted by default, and null makes the registry request fail. */
  registry?: RegistryResponse | null
  /** The selected project; slug `acme` by default. The registry's workspace is not read for it. */
  project?: Partial<Workspace>
  /** The route to render at; `/<prefix>/<slug>/<layer id>` by default. */
  route?: string
  /** Answers to the page's daemon calls; the workspace list, the registry and the signed-in actor are answered by the kit when the test does not. */
  api?: LayerApi
  /** What an overlay opened through useOverlay() resolves with; undefined (not confirmed) by default. */
  overlays?: LayerOverlayAnswer
  props?: Record<string, unknown>
  slots?: Record<string, unknown>
  /** Run the layer's Nuxt plugins (app/plugins) before mounting; true by default. */
  plugins?: boolean
}

export type GateState = 'ready' | 'not-ready' | 'not-enabled' | 'not-granted' | 'checking' | 'error'

export interface LayerPage {
  wrapper: VueWrapper
  router: Router
  html: () => string
  text: () => string
  find: (selector: string) => DOMWrapper<Element>
  findAll: (selector: string) => DOMWrapper<Element>[]
  /** The element with that `data-testid`. */
  byTestId: (id: string) => DOMWrapper<Element>
  /** What the gate rendered: the page (`ready`) or one of its lockout states. */
  gate: () => GateState
  /** Every daemon call so far, oldest first. */
  calls: LayerApiCall[]
  toasts: LayerToast[]
  /** Replace the registry and let the page re-read it. */
  setRegistry: (registry: RegistryResponse | null) => Promise<void>
  /** Wait for pending daemon calls, async components and re-renders. */
  flush: () => Promise<void>
  unmount: () => void
}

let registered: Record<string, Component> | undefined

/** Every component a page can name: the shell's, its layers', the layer's own, Nuxt's and the Nuxt UI stubs, with `Lazy` variants. */
export function layerComponents(): Record<string, Component> {
  if (registered) return registered
  const all: Record<string, Component> = { ...nuxtComponents }
  for (const name of layer.uiComponents) all[name] = uiStub(name)
  for (const [name, load] of Object.entries(layer.components)) all[name] = defineAsyncComponent(load)
  for (const [name, component] of Object.entries(all)) all[`Lazy${name}`] = component
  registered = all
  return all
}

/** Done when nothing is in flight and two idle turns rendered the same thing. */
async function settle(h: Harness, snapshot: () => string) {
  let previous: string | undefined
  for (let round = 0; round < 100; round++) {
    const waiting = [...h.pending, ...loading]
    if (waiting.length) await Promise.allSettled(waiting)
    await flushPromises()
    await nextTick()
    const current = snapshot()
    if (!waiting.length && current === previous) return
    previous = current
  }
}

async function runPlugins(h: Harness) {
  for (const load of layer.plugins) {
    const plugin = (await load()).default as unknown
    const setup = typeof plugin === 'function' ? plugin : (plugin as { setup?: unknown } | null)?.setup
    if (typeof setup === 'function') await setup(h.nuxtApp)
  }
}

/**
 * Mounts a layer page (or any of its components) as the shell would: the selected project in the route, the registry
 * served to the gate, daemon calls answered by the test, the shell's auto-imports and components in place and Nuxt UI
 * stubbed. Resolves once the first round of requests has landed.
 */
export async function renderLayerPage(component: Component, options: RenderLayerPageOptions = {}): Promise<LayerPage> {
  const project: Workspace = { ...DEFAULT_WORKSPACE, ...options.project }
  const prefix = layer.product.scope.urlPrefix
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: `/${prefix}/:project/:view(.*)*`, name: `${prefix}-project-view`, component: { render: () => null } },
      { path: '/:pathMatch(.*)*', name: 'catch-all', component: { render: () => null } },
    ],
  })
  const h: Harness = {
    app: null,
    router,
    project,
    registry: options.registry === undefined ? layerRegistry() : options.registry,
    api: options.api ?? {},
    overlays: options.overlays ?? (() => undefined),
    calls: [],
    toasts: [],
    state: new Map(),
    asyncData: new Map(),
    pending: new Set(),
    nuxtApp: undefined as unknown as Harness['nuxtApp'],
  }
  h.nuxtApp = createNuxtApp(h)
  activate(h)

  await router.push(options.route ?? `/${prefix}/${project.slug}/${layer.id}`)
  await router.isReady()
  if (options.plugins !== false) await runPlugins(h)

  // A host keeps the wrapper usable when the component itself is async, as a lazily registered card is.
  const host = defineComponent({
    setup: (_, { slots }) => () => render(component, options.props, slots),
  })
  const wrapper = mount(host, {
    slots: options.slots as never,
    global: {
      plugins: [router, { install: (app) => {
        h.app = app
        h.nuxtApp.vueApp = app
      } }],
      components: layerComponents(),
      provide: { [HARNESS as symbol]: h },
    },
  })
  const snapshot = () => wrapper.html()
  await settle(h, snapshot)

  const gate = (): GateState => {
    if (wrapper.find('[data-testid="view-lockout"]').exists()) return 'not-ready'
    if (wrapper.find('[data-testid="view-not-enabled"]').exists()) return 'not-enabled'
    if (wrapper.find('[data-testid="view-not-granted"]').exists()) return 'not-granted'
    const panel = wrapper.find('[data-ui="UDashboardPanel"][id^="gate-"]')
    if (!panel.exists()) return 'ready'
    return panel.find('[data-ui="UEmpty"][title="Checking access"]').exists() ? 'checking' : 'error'
  }

  return {
    wrapper,
    router,
    html: () => wrapper.html(),
    text: () => wrapper.text(),
    find: selector => wrapper.find(selector),
    findAll: selector => wrapper.findAll(selector),
    byTestId: id => wrapper.find(`[data-testid="${id}"]`),
    gate,
    calls: h.calls,
    toasts: h.toasts,
    setRegistry: async (registry) => {
      h.registry = registry
      await Promise.all([...h.asyncData.values()].map(entry => entry.refresh?.()))
      await settle(h, snapshot)
    },
    flush: () => settle(h, snapshot),
    unmount: () => {
      wrapper.unmount()
      deactivate(h)
    },
  }
}
