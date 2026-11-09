import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/candy-mountain'
import { listLayers, packageLayers, platformLayers } from '@crab-shack/platform-web/layer-list'
import { loadNuxt } from 'nuxt'
import type { NuxtApp, NuxtPage } from 'nuxt/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

const webRoot = fileURLToPath(new URL('../..', import.meta.url))

// The real config with every layer, loaded as nuxt build (production) or nuxt dev (development) does.
async function load(envName: 'production' | 'development') {
  const buildDir = await mkdtemp(join(tmpdir(), 'cm-web-'))
  const nuxt = await loadNuxt({ cwd: webRoot, ready: true, envName, overrides: { buildDir } })
  try {
    const app = {} as NuxtApp
    await nuxt.callHook('app:templates', app)
    const { platformWeb } = nuxt.options
    return { pages: app.pages ?? [], product: platformWeb ? platformWeb.product : undefined, layers: nuxt.options._layers.map(layer => layer.meta?.name).filter(name => typeof name === 'string') }
  }
  finally {
    await nuxt.close()
    await rm(buildDir, { recursive: true, force: true })
  }
}

const routeNames = (tree: NuxtPage[]): string[] => tree.flatMap(page => [...(page.name ? [page.name] : []), ...routeNames(page.children ?? [])])
const sorted = (ids: Iterable<string>) => [...ids].sort()

const withPages = (packages: Map<string, { dir: string }>) => [...packages].filter(([, layer]) => existsSync(join(layer.dir, 'app', 'pages'))).map(([id]) => id)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Candy Mountain web distribution', () => {
  it('extends the product\'s layers and then the platform shell, with the product as the shell\'s option', async () => {
    vi.stubGlobal('defineNuxtConfig', <T>(config: T) => config)
    const config = (await import('../../nuxt.config')).default
    expect(config.extends).toEqual([...listLayers(CANDY_MOUNTAIN_PRODUCT.layers, webRoot), '@crab-shack/platform-web'])
    expect(config.platformWeb).toEqual({ product: CANDY_MOUNTAIN_PRODUCT })
    expect(config.$development).toBeUndefined()
    expect(config.$production).toBeUndefined()
  })

  it('lists exactly the layer packages it depends on plus the shell\'s own, and resolves each to its package', () => {
    const packages = packageLayers(webRoot)
    expect(existsSync(join(webRoot, 'layers'))).toBe(false)
    expect(sorted(CANDY_MOUNTAIN_PRODUCT.layers)).toEqual(sorted([...packages.keys(), ...platformLayers()]))
    const own = CANDY_MOUNTAIN_PRODUCT.layers.filter(id => !platformLayers().includes(id))
    expect(listLayers(CANDY_MOUNTAIN_PRODUCT.layers, webRoot).map(([dir]) => dir)).toEqual(own.map(id => packages.get(id)?.dir))
    expect([...packages.values()].map(pkg => pkg.name).filter(name => !name.startsWith('@candy-mountain/'))).toEqual([])
  })

  it.each(['production', 'development'] as const)('serves the shell pages and every layer\'s pages under /p/ in %s, with the product', async (envName) => {
    const packages = packageLayers(webRoot)
    const loaded = await load(envName)
    const names = routeNames(loaded.pages)
    expect(loaded.pages.map(page => page.path)).toContain('/p/:project()')
    expect(names).toEqual(expect.arrayContaining(['projects', 'p-project', 'p-project-setup-plugins']))
    expect(withPages(packages).filter(id => !names.includes(`p-project-${id}`))).toEqual([])
    expect(sorted(loaded.layers.filter(id => packages.has(id)))).toEqual(sorted(packages.keys()))
    expect(loaded.product).toEqual(CANDY_MOUNTAIN_PRODUCT)
  }, 60_000)
})
