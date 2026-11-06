import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/candy-mountain'
import { listLayers, packageLayers, platformLayers } from '@candy-mountain/platform-web/layer-list'
import { loadNuxt } from 'nuxt'
import type { NuxtApp, NuxtPage } from 'nuxt/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

const webRoot = fileURLToPath(new URL('../..', import.meta.url))

// The real config with every layer, loaded as nuxt build does.
async function pages(): Promise<NuxtPage[]> {
  const buildDir = await mkdtemp(join(tmpdir(), 'cm-web-'))
  const nuxt = await loadNuxt({ cwd: webRoot, ready: true, overrides: { buildDir } })
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

const routeNames = (tree: NuxtPage[]): string[] => tree.flatMap(page => [...(page.name ? [page.name] : []), ...routeNames(page.children ?? [])])

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Candy Mountain web distribution', () => {
  it('extends the platform shell and hands it the product configuration', async () => {
    vi.stubGlobal('defineNuxtConfig', <T>(config: T) => config)
    const config = (await import('../../nuxt.config')).default
    expect(config.extends).toEqual([...listLayers(CANDY_MOUNTAIN_PRODUCT.layers, webRoot), '@candy-mountain/platform-web'])
    expect(config.platformWeb).toEqual({ product: CANDY_MOUNTAIN_PRODUCT })
  })

  it('lists every layer package it depends on and the shell\'s own layers in the product configuration, and nothing else', () => {
    const packages = packageLayers(webRoot)
    expect(existsSync(join(webRoot, 'layers'))).toBe(false)
    expect([...CANDY_MOUNTAIN_PRODUCT.layers].sort()).toEqual([...packages.keys(), ...platformLayers()].sort())
    const own = CANDY_MOUNTAIN_PRODUCT.layers.filter(id => !platformLayers().includes(id))
    expect(listLayers(CANDY_MOUNTAIN_PRODUCT.layers, webRoot).map(([dir]) => dir)).toEqual(own.map(id => packages.get(id)?.dir))
  })

  it('serves the shell pages and every capability layer\'s pages under /p/', async () => {
    const tree = await pages()
    const names = routeNames(tree)
    expect(tree.map(page => page.path)).toContain('/p/:project()')
    expect(names).toEqual(expect.arrayContaining(['projects', 'p-project', 'p-project-setup-plugins']))
    const withPages = [...packageLayers(webRoot)].filter(([, layer]) => existsSync(join(layer.dir, 'app', 'pages'))).map(([id]) => id)
    expect(withPages.filter(id => !names.includes(`p-project-${id}`))).toEqual([])
  }, 60_000)
})
