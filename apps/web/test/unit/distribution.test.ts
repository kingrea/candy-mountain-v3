import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANDY_MOUNTAIN_DEVELOPMENT, CANDY_MOUNTAIN_DEVELOPMENT_PRODUCT, CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/candy-mountain'
import { listLayers, packageLayers, platformLayers } from '@candy-mountain/platform-web/layer-list'
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

/** The web app's layer packages split by where package.json lists them: a dependency ships, a devDependency runs only under nuxt dev. */
function layerPackages() {
  const manifest = JSON.parse(readFileSync(join(webRoot, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>, devDependencies?: Record<string, string> }
  const all = packageLayers(webRoot)
  const shipped = new Map([...all].filter(([, pkg]) => pkg.name in (manifest.dependencies ?? {})))
  const development = new Map([...all].filter(([, pkg]) => pkg.name in (manifest.devDependencies ?? {})))
  return { all, shipped, development }
}

const withPages = (packages: Map<string, { dir: string }>) => [...packages].filter(([, layer]) => existsSync(join(layer.dir, 'app', 'pages'))).map(([id]) => id)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Candy Mountain web distribution', () => {
  it('extends the platform shell and the build\'s layers, and names the development layers and each product under its environment', async () => {
    vi.stubGlobal('defineNuxtConfig', <T>(config: T) => config)
    const config = (await import('../../nuxt.config')).default
    expect(config.extends).toEqual([...listLayers(CANDY_MOUNTAIN_PRODUCT.layers, webRoot), '@candy-mountain/platform-web'])
    expect(config.platformWeb).toBeUndefined()
    expect(config.$production).toEqual({ platformWeb: { product: CANDY_MOUNTAIN_PRODUCT } })
    expect(config.$development).toMatchObject({ extends: listLayers(CANDY_MOUNTAIN_DEVELOPMENT.layers, webRoot), platformWeb: { product: CANDY_MOUNTAIN_DEVELOPMENT_PRODUCT } })
    expect(listLayers(CANDY_MOUNTAIN_DEVELOPMENT.layers, webRoot).length).toBeGreaterThan(0)
  })

  it('lists every layer package it depends on where package.json puts it: dependencies in the product\'s layers with the shell\'s own, devDependencies in the development layers, and nothing else', () => {
    const { shipped, development } = layerPackages()
    expect(existsSync(join(webRoot, 'layers'))).toBe(false)
    expect(sorted(CANDY_MOUNTAIN_PRODUCT.layers)).toEqual(sorted([...shipped.keys(), ...platformLayers()]))
    expect(sorted(CANDY_MOUNTAIN_DEVELOPMENT.layers)).toEqual(sorted(development.keys()))
    const own = CANDY_MOUNTAIN_PRODUCT.layers.filter(id => !platformLayers().includes(id))
    expect(listLayers(CANDY_MOUNTAIN_PRODUCT.layers, webRoot).map(([dir]) => dir)).toEqual(own.map(id => shipped.get(id)?.dir))
    expect(listLayers(CANDY_MOUNTAIN_DEVELOPMENT.layers, webRoot).map(([dir]) => dir)).toEqual(CANDY_MOUNTAIN_DEVELOPMENT.layers.map(id => development.get(id)?.dir))
  })

  it('serves the shell pages and every shipped layer\'s pages under /p/ in a build, and none of a development layer\'s', async () => {
    const { shipped, development } = layerPackages()
    const built = await load('production')
    const names = routeNames(built.pages)
    expect(built.pages.map(page => page.path)).toContain('/p/:project()')
    expect(names).toEqual(expect.arrayContaining(['projects', 'p-project', 'p-project-setup-plugins']))
    expect(withPages(shipped).filter(id => !names.includes(`p-project-${id}`))).toEqual([])
    expect(withPages(development).filter(id => names.includes(`p-project-${id}`))).toEqual([])
    expect(built.layers.filter(id => development.has(id))).toEqual([])
    expect(built.product).toEqual(CANDY_MOUNTAIN_PRODUCT)
  }, 60_000)

  it('serves the development layers\' pages as well under nuxt dev, with the product that lists them', async () => {
    const { all } = layerPackages()
    const dev = await load('development')
    const names = routeNames(dev.pages)
    expect(withPages(all).filter(id => !names.includes(`p-project-${id}`))).toEqual([])
    expect(sorted(dev.layers.filter(id => all.has(id)))).toEqual(sorted(all.keys()))
    expect(dev.product).toEqual(CANDY_MOUNTAIN_DEVELOPMENT_PRODUCT)
  }, 60_000)
})
