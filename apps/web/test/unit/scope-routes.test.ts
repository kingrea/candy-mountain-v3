import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadNuxt } from 'nuxt'
import type { NuxtApp, NuxtPage } from 'nuxt/schema'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router'
import { SCOPE_PAGES_DIR, scopeRoutes } from '../../scope-routes.mjs'

const { PREFIX } = vi.hoisted(() => ({ PREFIX: 'w' }))

vi.mock('../../shared/utils/product', async (importOriginal) => {
  const { PRODUCT } = await importOriginal<typeof import('../../shared/utils/product')>()
  return { PRODUCT: { ...PRODUCT, scope: { ...PRODUCT.scope, urlPrefix: PREFIX } } }
})

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url))

// The real config, loaded outside vitest's mocks, so this is the tree Nuxt builds today from core and every layer.
async function defaultPages(): Promise<NuxtPage[]> {
  const buildDir = await mkdtemp(join(tmpdir(), 'cm-scope-routes-'))
  const nuxt = await loadNuxt({ cwd: WEB_ROOT, ready: true, overrides: { buildDir } })
  try {
    const app = {} as NuxtApp
    await nuxt.callHook('app:templates', app)
    return app.pages ?? []
  }
  finally {
    await nuxt.close()
    await rm(buildDir, { recursive: true, force: true })
  }
}

// The config as vitest sees it, with the product mocked to PREFIX.
async function mockedConfigHook() {
  vi.stubGlobal('defineNuxtConfig', <T>(config: T) => config)
  const config = (await import('../../nuxt.config')).default
  const hook = config.hooks?.['pages:extend']
  if (typeof hook !== 'function') throw new Error('nuxt.config registers no pages:extend hook')
  return hook as (pages: NuxtPage[]) => void
}

const toRecords = (pages: NuxtPage[]): RouteRecordRaw[] =>
  pages.map(page => ({ path: page.path, name: page.name, component: {}, children: toRecords(page.children ?? []) }) as RouteRecordRaw)

const routerFor = (pages: NuxtPage[]) => createRouter({ history: createMemoryHistory(), routes: toRecords(pages) })

// Every scoped page as [route name, a concrete URL below the scope segment].
function scopedRoutes(pages: NuxtPage[], base = ''): [string, string][] {
  return pages.flatMap((page) => {
    const path = [base, page.path].filter(Boolean).join('/').replace(/:[^/]+/g, 'x')
    const own: [string, string][] = page.name ? [[page.name, path]] : []
    return [...own, ...scopedRoutes(page.children ?? [], path)]
  })
}

function matchedName(router: ReturnType<typeof routerFor>, path: string) {
  const route = router.resolve(path)
  return route.matched.length ? route.name : undefined
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('scoped routes', () => {
  let pages: NuxtPage[]
  let scoped: [string, string][]

  beforeAll(async () => {
    pages = await defaultPages()
    const top = pages.filter(page => page.path.startsWith(`/${SCOPE_PAGES_DIR}/`))
    scoped = scopedRoutes(top).map(([name, path]) => [name, path.slice(SCOPE_PAGES_DIR.length + 2)])
  }, 60_000)

  it('keeps every scoped page at /p/ under the default configuration', () => {
    expect(pages.map(page => page.path)).toContain('/p/:project()')
    expect(scoped.map(([name]) => name)).toEqual(expect.arrayContaining(['p-project', 'p-project-issues', 'p-project-issues-id', 'p-project-setup-plugins']))
    const router = routerFor(pages)
    for (const [name, path] of scoped) expect(matchedName(router, `/p/${path}`)).toBe(name)
  })

  it('moves every scoped page to the configured prefix and leaves the old one unmatched', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const moved = structuredClone(pages)
    ;(await mockedConfigHook())(moved)
    const router = routerFor(moved)

    for (const [name, path] of scoped) {
      expect(matchedName(router, `/${PREFIX}/${path}`)).toBe(name)
      expect(matchedName(router, `/p/${path}`)).toBeUndefined()
    }
    expect(matchedName(router, '/projects')).toBe('projects')
  })

  it('builds core links and switch paths with the configured prefix', async () => {
    const { PROJECT_ROUTE_PREFIX, projectPath, projectSwitchPath } = await import('../../app/utils/project-scope')
    const moved = structuredClone(pages)
    ;(await mockedConfigHook())(moved)
    const router = routerFor(moved)

    expect(PROJECT_ROUTE_PREFIX).toBe(`/${PREFIX}`)
    expect(projectPath('acme', 'issues')).toBe(`/${PREFIX}/acme/issues`)
    expect(matchedName(router, projectPath('acme'))).toBe('p-project')
    expect(matchedName(router, projectPath('acme', 'setup', 'plugins'))).toBe('p-project-setup-plugins')
    const issuePattern = router.resolve(`/${PREFIX}/acme/issues/42`).matched.at(-1)?.path
    expect(projectSwitchPath(issuePattern, 'beta')).toBe(`/${PREFIX}/beta/issues`)
  })
})

describe('scopeRoutes', () => {
  const tree = () => [{ path: '/p/:project()', children: [{ path: 'issues' }] }, { path: '/p' }, { path: '/pages' }, { path: '/projects' }]

  it('leaves the routes alone when the prefix is the directory name', () => {
    const pages = tree()
    scopeRoutes(pages, SCOPE_PAGES_DIR)
    expect(pages).toEqual(tree())
  })

  it('moves only routes under the scope directory', () => {
    const pages = tree()
    scopeRoutes(pages, 'ws')
    expect(pages).toEqual([{ path: '/ws/:project()', children: [{ path: 'issues' }] }, { path: '/ws' }, { path: '/pages' }, { path: '/projects' }])
  })

  it.each(['', 'a/b', 'W', '-p', 'p q'])('rejects the prefix %j', (prefix) => {
    expect(() => scopeRoutes(tree(), prefix)).toThrow('one lowercase path segment')
  })
})
