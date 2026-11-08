import {
  ME_PATH,
  ORGANISATIONS_PATH,
  WORKSPACES_PATH,
  workspaceRegistryPath,
  type MeResponse,
  type OrganisationListResponse,
  type RegistryResponse,
  type Workspace,
  type WorkspaceListResponse,
} from '@candy-mountain/platform-sdk'
import {
  computed,
  defineAsyncComponent as defineVueAsyncComponent,
  getCurrentInstance,
  inject,
  isRef,
  reactive,
  ref,
  shallowRef,
  toValue,
  watch,
  type App,
  type Component,
  type ComputedRef,
  type InjectionKey,
  type MaybeRefOrGetter,
  type Ref,
  type WatchSource,
} from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, type RouteLocationNormalizedLoaded, type RouteLocationRaw, type Router } from 'vue-router'

/** One daemon call a page made through `$api` or `useApi`. */
export interface LayerApiCall {
  method: string
  path: string
  body?: unknown
  query?: unknown
}

/**
 * The test's answers to daemon calls: a function answering a call (undefined means "not mine"), or a map from
 * `'<METHOD> <path>'` to the answer or a function producing it. A thrown value rejects the call like a failed request.
 */
export type LayerApi =
  | ((call: LayerApiCall) => unknown)
  | Record<string, unknown | ((call: LayerApiCall) => unknown)>

export interface LayerToast {
  title?: string
  description?: string
  color?: string
  [key: string]: unknown
}

export type LayerOverlayAnswer = (component: Component, props: Record<string, unknown>) => unknown

export interface Harness {
  app: App | null
  router: Router
  project: Workspace
  registry: RegistryResponse | null
  api: LayerApi
  overlays: LayerOverlayAnswer
  calls: LayerApiCall[]
  toasts: LayerToast[]
  state: Map<string, Ref<unknown>>
  asyncData: Map<string, AsyncDataEntry>
  pending: Set<Promise<unknown>>
  nuxtApp: NuxtAppFake
}

export const HARNESS: InjectionKey<Harness> = Symbol('platform-web-test')

let active: Harness | null = null

export function activate(harness: Harness) {
  active = harness
}

export function deactivate(harness: Harness) {
  if (active === harness) active = null
}

/** The render in progress: the mounted app's, or the last one started, since Nuxt composables also run outside setup. */
export function harness(): Harness {
  const injected = getCurrentInstance() ? inject(HARNESS, null) : null
  const found = injected ?? active
  if (!found) throw new Error('No layer page is rendering: call renderLayerPage() from @candy-mountain/platform-web/test first.')
  return found
}

export function track<T>(h: Harness, promise: Promise<T>): Promise<T> {
  h.pending.add(promise)
  const done = () => h.pending.delete(promise)
  promise.then(done, done)
  return promise
}

/** Component loads in flight, which a render waits for along with the daemon calls. */
export const loading = new Set<Promise<unknown>>()

export function trackLoad<T>(promise: Promise<T>): Promise<T> {
  loading.add(promise)
  const done = () => loading.delete(promise)
  promise.then(done, done)
  return promise
}

/** Vue's defineAsyncComponent with the load tracked, so a card a layer plugin registers lazily is there when the render settles. */
export const defineAsyncComponent: typeof defineVueAsyncComponent = (source) => {
  if (typeof source === 'function') return defineVueAsyncComponent(() => trackLoad(source()))
  return defineVueAsyncComponent({ ...source, loader: () => trackLoad(source.loader()) })
}

/** A failed request as a page sees one from the shell's `$api`: `data` carries the daemon's error body. */
export function layerApiError(code: string, message: string, status = 400) {
  return Object.assign(new Error(message), {
    status,
    statusCode: status,
    data: { error: { code, message } },
    response: { status, _data: { error: { code, message } } },
  })
}

export function answerCall(h: Harness, call: LayerApiCall): unknown {
  const answer = typeof h.api === 'function' ? h.api(call) : h.api[`${call.method} ${call.path}`]
  const value = typeof answer === 'function' ? (answer as (call: LayerApiCall) => unknown)(call) : answer
  if (value !== undefined) return value
  if (call.method !== 'GET') return undefined
  if (call.path === WORKSPACES_PATH) return { workspaces: [h.project] } satisfies WorkspaceListResponse
  if (call.path === ORGANISATIONS_PATH) return { organisations: [] } satisfies OrganisationListResponse
  if (call.path === workspaceRegistryPath(h.project.slug)) {
    if (h.registry) return h.registry
    throw layerApiError('not_found', `Workspace ${h.project.slug} was not found`, 404)
  }
  if (call.path === ME_PATH) {
    return { actor: { id: 'tester', username: 'tester', displayName: 'Tester', roles: h.registry?.admin ? ['admin'] : [] } } satisfies MeResponse
  }
  return undefined
}

interface FetchOptions {
  method?: string
  body?: unknown
  query?: unknown
  headers?: unknown
}

export async function request(h: Harness, path: string, options: FetchOptions = {}): Promise<unknown> {
  const call: LayerApiCall = { method: (options.method ?? 'GET').toUpperCase(), path }
  if (options.body !== undefined) call.body = options.body
  if (options.query !== undefined) call.query = options.query
  h.calls.push(call)
  const value = await answerCall(h, call)
  if (value !== undefined) return value
  throw new Error(`Unanswered daemon call ${call.method} ${call.path}: answer it through the api option of renderLayerPage().`)
}

export interface NuxtAppFake {
  $api: (path: string, options?: FetchOptions) => Promise<unknown>
  $router: Router
  vueApp: App | null
  payload: { data: Record<string, unknown>, state: Record<string, unknown> }
  isHydrating: boolean
  ssrContext: undefined
  provide: (name: string, value: unknown) => void
  hook: (...args: unknown[]) => () => void
  hooks: { hook: (...args: unknown[]) => () => void, callHook: (...args: unknown[]) => Promise<void> }
  callHook: (...args: unknown[]) => Promise<void>
  runWithContext: <T>(fn: () => T) => T
  [key: `$${string}`]: unknown
}

export function createNuxtApp(h: Harness): NuxtAppFake {
  const hook = () => () => {}
  const callHook = async () => {}
  const nuxtApp: NuxtAppFake = {
    $api: (path, options) => request(h, path, options),
    $router: h.router,
    vueApp: null,
    payload: { data: {}, state: {} },
    isHydrating: false,
    ssrContext: undefined,
    provide: (name, value) => {
      nuxtApp[`$${name}`] = value
    },
    hook,
    hooks: { hook, callHook },
    callHook,
    runWithContext: fn => fn(),
  }
  return nuxtApp
}

// Nuxt app composables as a page reaches them by auto-import; each reads the render in progress.

export const useNuxtApp = () => harness().nuxtApp

export const useRouter = () => harness().router

export function useRoute(): RouteLocationNormalizedLoaded {
  const instance = getCurrentInstance()
  return instance?.appContext.config.globalProperties.$route ?? harness().router.currentRoute.value
}

export { onBeforeRouteLeave, onBeforeRouteUpdate }

export const navigateTo = (to: RouteLocationRaw | null | undefined) => (to == null ? Promise.resolve() : harness().router.push(to))
export const abortNavigation = (error?: unknown) => {
  if (error) throw error
  return false
}

export const defineNuxtPlugin = <T>(plugin: T) => plugin
export const defineNuxtRouteMiddleware = <T>(middleware: T) => middleware
export const definePageMeta = () => {}
export const useHead = () => {}
export const useSeoMeta = () => {}
export const useRequestHeaders = () => ({})
export const useRequestURL = () => new URL(harness().router.currentRoute.value.fullPath, 'http://localhost')
export const useRuntimeConfig = () => ({ public: {}, app: { baseURL: '/' } })
export const useAppConfig = () => ({})
export const onNuxtReady = (fn: () => unknown) => void fn()
export const callOnce = (...args: unknown[]) => Promise.resolve((args.at(-1) as () => unknown)())
export const defineShortcuts = () => {}
export const useColorMode = () => reactive({ preference: 'light', value: 'light', unknown: false, forced: false })
export const prerenderRoutes = () => {}

export function createError(input: string | { statusCode?: number, statusMessage?: string, message?: string, data?: unknown }) {
  const options = typeof input === 'string' ? { message: input } : input
  return Object.assign(new Error(options.message ?? options.statusMessage ?? 'Error'), options)
}
export const showError = (error: unknown) => {
  throw error instanceof Error ? error : createError(String(error))
}
export const clearError = () => Promise.resolve()
export const useError = () => ref(null)

export function useState<T>(keyOrInit: string | (() => T), init?: () => T): Ref<T> {
  const h = harness()
  const key = typeof keyOrInit === 'string' ? keyOrInit : `state:${h.state.size}`
  const initial = typeof keyOrInit === 'function' ? keyOrInit : init
  let state = h.state.get(key)
  if (!state) {
    state = ref(initial?.())
    h.state.set(key, state)
  }
  return state as Ref<T>
}

export function useCookie<T>(name: string, options: { default?: () => T } = {}): Ref<T> {
  return useState(`cookie:${name}`, options.default ?? (() => undefined as T))
}

export type AsyncDataStatus = 'idle' | 'pending' | 'success' | 'error'

export interface AsyncDataEntry {
  data: Ref<unknown>
  error: Ref<unknown>
  status: Ref<AsyncDataStatus>
  refresh?: () => Promise<void>
  promise?: Promise<void>
}

export interface AsyncDataOptions<T> {
  default?: () => T
  immediate?: boolean
  lazy?: boolean
  server?: boolean
  watch?: WatchSource[] | false
  transform?: (input: unknown) => T
  deep?: boolean
  dedupe?: string
  getCachedData?: unknown
}

export interface AsyncDataFields<T> {
  data: Ref<T>
  pending: ComputedRef<boolean>
  status: ComputedRef<AsyncDataStatus>
  error: ComputedRef<unknown>
  refresh: () => Promise<void>
  execute: () => Promise<void>
  clear: () => void
}

/** Awaitable like Nuxt's: the fields sit on a promise of them that settles with the first fetch. */
export type AsyncData<T> = AsyncDataFields<T> & Promise<AsyncDataFields<T>>

type AsyncDataKey = MaybeRefOrGetter<string>
type AsyncDataHandler<T> = (nuxtApp: NuxtAppFake) => Promise<T> | T

function entryFor(h: Harness, key: string, initial: () => unknown): AsyncDataEntry {
  let entry = h.asyncData.get(key)
  if (!entry) {
    entry = { data: shallowRef(initial()), error: shallowRef(undefined), status: ref<AsyncDataStatus>('idle') }
    h.asyncData.set(key, entry)
  }
  return entry
}

let anonymousKeys = 0

/** Nuxt's useAsyncData as the shell's composables use it: keyed, shared by key, reactive to a key function or watch sources, awaitable. */
export function useAsyncData<T>(...args: unknown[]): AsyncData<T> {
  const keyed = typeof args[1] === 'function'
  const keyArg = (keyed ? args[0] : `anonymous:${anonymousKeys++}`) as AsyncDataKey
  const handler = (keyed ? args[1] : args[0]) as AsyncDataHandler<T>
  const options = ((keyed ? args[2] : args[1]) ?? {}) as AsyncDataOptions<T>
  const h = harness()
  const initial = () => options.default?.()

  const current = shallowRef(entryFor(h, toValue(keyArg), initial))

  function execute(): Promise<void> {
    const entry = current.value
    entry.status.value = 'pending'
    const run = Promise.resolve()
      .then(() => handler(h.nuxtApp))
      .then(
        (result) => {
          entry.data.value = options.transform ? options.transform(result) : result
          entry.error.value = undefined
          entry.status.value = 'success'
        },
        (error) => {
          entry.error.value = error
          entry.status.value = 'error'
        },
      )
    entry.promise = run
    return track(h, run)
  }

  // Like Nuxt, a key already fetched or in flight is shared rather than fetched again; refresh() always fetches.
  function settleKey() {
    const entry = current.value
    entry.refresh = execute
    if (entry.status.value === 'success' || (entry.status.value === 'pending' && entry.promise)) return
    void execute()
  }

  if (typeof keyArg === 'function' || isRef(keyArg)) {
    watch(() => toValue(keyArg), (key) => {
      current.value = entryFor(h, key, initial)
      settleKey()
    })
  }
  if (options.watch) watch(options.watch, () => void execute(), { deep: true })
  if (options.immediate !== false) settleKey()
  else current.value.refresh = execute

  const fields: AsyncDataFields<T> = {
    data: computed({ get: () => current.value.data.value as T, set: value => void (current.value.data.value = value) }),
    pending: computed(() => current.value.status.value === 'pending'),
    status: computed(() => current.value.status.value),
    error: computed(() => current.value.error.value),
    refresh: execute,
    execute,
    clear: () => {
      current.value.data.value = initial()
      current.value.error.value = undefined
      current.value.status.value = 'idle'
    },
  }
  return Object.assign((current.value.promise ?? Promise.resolve()).then(() => fields), fields)
}

export const useLazyAsyncData = useAsyncData

export function useNuxtData<T>(key: string) {
  return { data: entryFor(harness(), key, () => undefined).data as Ref<T | undefined> }
}

export function refreshNuxtData(keys?: string | string[]): Promise<void> {
  const h = harness()
  const wanted = keys === undefined ? undefined : new Set(Array.isArray(keys) ? keys : [keys])
  const refreshes = [...h.asyncData].filter(([key]) => !wanted || wanted.has(key)).map(([, entry]) => entry.refresh?.())
  return Promise.all(refreshes).then(() => undefined)
}

export function clearNuxtData(keys?: string | string[]) {
  const h = harness()
  const wanted = keys === undefined ? undefined : new Set(Array.isArray(keys) ? keys : [keys])
  for (const [key, entry] of h.asyncData) {
    if (wanted && !wanted.has(key)) continue
    entry.data.value = undefined
    entry.error.value = undefined
    entry.status.value = 'idle'
  }
}

interface UseFetchOptions<T> extends AsyncDataOptions<T>, FetchOptions {
  key?: string
}

/** Nuxt's createUseFetch, which the shell's useApi is built from: a request as async data keyed on its method, path and query. */
export function createUseFetch(context: () => { $fetch: (path: string, options?: FetchOptions) => Promise<unknown> }) {
  return function useFetch<T>(input: MaybeRefOrGetter<string>, options: UseFetchOptions<T> = {}): AsyncData<T> {
    const { key, watch: sources, method, body, query, headers, ...asyncOptions } = options
    const url = () => toValue(input)
    const fetchOptions = () => ({ method: toValue(method), body: toValue(body), query: toValue(query), headers: toValue(headers) })
    const keyFor = () => key ?? `fetch:${(toValue(method) ?? 'GET').toUpperCase()}:${url()}:${JSON.stringify(toValue(query) ?? null)}`
    return useAsyncData<T>(keyFor, () => context().$fetch(url(), fetchOptions()), {
      ...asyncOptions,
      watch: sources === false ? false : [...(sources ?? []), url, () => fetchOptions()],
    })
  }
}

export function useToast() {
  const h = harness()
  return {
    toasts: computed(() => h.toasts),
    add: (toast: LayerToast) => {
      h.toasts.push(toast)
      return toast
    },
    update: () => {},
    remove: () => {},
    clear: () => {
      h.toasts.length = 0
    },
  }
}

/** Nuxt UI's overlay API without rendering: `open()` resolves `result` with the test's overlays answer. */
export function useOverlay() {
  const h = harness()
  return {
    create: (component: Component, options: { props?: Record<string, unknown> } = {}) => {
      const instance = {
        id: Symbol('overlay'),
        open: (props: Record<string, unknown> = {}) => {
          const result = Promise.resolve(h.overlays(component, { ...options.props, ...props }))
          void track(h, result)
          return { id: instance.id, result, close: () => {}, patch: () => {} }
        },
        close: () => {},
        patch: () => {},
        isOpen: () => false,
      }
      return instance
    },
    open: () => {},
    close: () => {},
    patch: () => {},
    isOpen: () => false,
    overlays: [],
  }
}
