import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProductConfig } from '@candy-mountain/platform-sdk'
import { loadNuxt } from 'nuxt'
import type { NuxtApp, NuxtPage } from 'nuxt/schema'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router'
import { PLAYGROUND_PRODUCT } from '../../playground/product'
import { SCOPE_PAGES_DIR, scopeListRoute, scopeRoutes } from '../../scope-routes.mjs'

const { PREFIX } = vi.hoisted(() => ({ PREFIX: 'w' }))

vi.mock('../../shared/utils/product', async (importOriginal) => {
  const { PRODUCT } = await importOriginal<typeof import('../../shared/utils/product')>()
  return { PRODUCT: { ...PRODUCT, scope: { ...PRODUCT.scope, urlPrefix: PREFIX } } }
})

const PLAYGROUND = fileURLToPath(new URL('../../playground', import.meta.url))
const MOVED: ProductConfig = { ...PLAYGROUND_PRODUCT, scope: { ...PLAYGROUND_PRODUCT.scope, urlPrefix: PREFIX } }

// The shell on its own, as the playground hosts it, so this is the tree the platform-web module hands every distribution.
async function pagesFor(product: ProductConfig): Promise<NuxtPage[]> {
  const buildDir = await mkdtemp(join(tmpdir(), 'cm-scope-routes-'))
  const nuxt = await loadNuxt({ cwd: PLAYGROUND, ready: true, overrides: { buildDir, platformWeb: { product } } })
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

describe('scoped routes', () => {
  let pages: NuxtPage[]
  let scoped: [string, string][]

  beforeAll(async () => {
    pages = await pagesFor(PLAYGROUND_PRODUCT)
    const top = pages.filter(page => page.path.startsWith(`/${SCOPE_PAGES_DIR}/`))
    scoped = scopedRoutes(top).map(([name, path]) => [name, path.slice(SCOPE_PAGES_DIR.length + 2)])
  }, 60_000)

  it('keeps every scoped page at /p/ under a product with that prefix', () => {
    expect(pages.map(page => page.path)).toContain('/p/:project()')
    expect(scoped.map(([name]) => name)).toEqual(expect.arrayContaining(['p-project', 'p-project-setup-modules', 'p-project-setup-plugins']))
    const router = routerFor(pages)
    for (const [name, path] of scoped) expect(matchedName(router, `/p/${path}`)).toBe(name)
  })

  it('moves every scoped page to the configured prefix and leaves the old one unmatched', async () => {
    const router = routerFor(await pagesFor(MOVED))
    for (const [name, path] of scoped) {
      expect(matchedName(router, `/${PREFIX}/${path}`)).toBe(name)
      expect(matchedName(router, `/p/${path}`)).toBeUndefined()
    }
    expect(matchedName(router, '/projects')).toBe('projects')
  }, 60_000)

  it('builds core links and switch paths with the configured prefix', async () => {
    const { PROJECT_ROUTE_PREFIX, projectPath, projectSwitchPath } = await import('../../app/utils/project-scope')
    const moved = structuredClone(pages)
    scopeRoutes(moved, PREFIX)
    const router = routerFor(moved)

    expect(PROJECT_ROUTE_PREFIX).toBe(`/${PREFIX}`)
    expect(projectPath('acme', 'setup', 'plugins')).toBe(`/${PREFIX}/acme/setup/plugins`)
    expect(matchedName(router, projectPath('acme'))).toBe('p-project')
    expect(matchedName(router, projectPath('acme', 'setup', 'plugins'))).toBe('p-project-setup-plugins')
    const pluginsPattern = router.resolve(`/${PREFIX}/acme/setup/plugins`).matched.at(-1)?.path
    expect(projectSwitchPath(pluginsPattern, 'beta')).toBe(`/${PREFIX}/beta/setup/plugins`)
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

describe('scopeListRoute', () => {
  const tree = () => [{ path: '/p/:project()' }, { path: '/projects' }, { path: '/activity' }]

  it('moves only the workspace list page', () => {
    const pages = tree()
    scopeListRoute(pages, 'apps')
    expect(pages).toEqual([{ path: '/p/:project()' }, { path: '/apps' }, { path: '/activity' }])
  })

  it.each(['', 'a/b', 'Apps'])('rejects the list path %j', (listPath) => {
    expect(() => scopeListRoute(tree(), listPath)).toThrow('one lowercase path segment')
  })
})
