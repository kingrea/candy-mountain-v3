import { mkdtemp, rm } from 'node:fs/promises'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/platform-sdk'
import { hasNuxtConfig, listLayers, platformLayers } from '@candy-mountain/platform-web/layer-list'
import { loadNuxt } from 'nuxt'
import type { NuxtApp, NuxtPage } from 'nuxt/schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

const webRoot = fileURLToPath(new URL('../..', import.meta.url))

const layerDirectories = () => readdirSync(join(webRoot, 'layers')).filter(name => hasNuxtConfig(join(webRoot, 'layers', name)))

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
    expect(config.extends).toEqual(['@candy-mountain/platform-web'])
    expect(config.platformWeb?.product).toBe(CANDY_MOUNTAIN_PRODUCT)
  })

  it('lists every capability layer directory and the shell\'s own layers in the product configuration', () => {
    expect([...CANDY_MOUNTAIN_PRODUCT.layers].sort()).toEqual([...layerDirectories(), ...platformLayers()].sort())
    const own = CANDY_MOUNTAIN_PRODUCT.layers.filter(id => !platformLayers().includes(id))
    expect(listLayers(CANDY_MOUNTAIN_PRODUCT.layers, webRoot).map(([dir]) => dir)).toEqual(own.map(id => join(webRoot, 'layers', id)))
  })

  it('serves the shell pages and every capability page under /p/', async () => {
    const tree = await pages()
    expect(tree.map(page => page.path)).toContain('/p/:project()')
    expect(routeNames(tree)).toEqual(expect.arrayContaining(['projects', 'p-project', 'p-project-setup-plugins', 'p-project-issues', 'p-project-issues-id', 'p-project-bots']))
  }, 60_000)
})
