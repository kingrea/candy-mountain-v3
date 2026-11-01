import { readdirSync, realpathSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadNuxt } from 'nuxt/kit'
import { describe, expect, it } from 'vitest'
import { hasNuxtConfig, layerListConfig, listLayers, packageLayers } from '../../layer-list.mjs'
import { PRODUCT } from '../../shared/utils/product'

const webRoot = fileURLToPath(new URL('../..', import.meta.url))
const fixtureRoot = fileURLToPath(new URL('../fixtures/layered-app', import.meta.url))
const packageRoot = realpathSync(fileURLToPath(new URL('../fixtures/delta-layer', import.meta.url)))

async function registeredLayers(overrides: Record<string, unknown>) {
  const nuxt = await loadNuxt({ cwd: fixtureRoot, ready: false, overrides })
  try {
    await nuxt.callHook('modules:before')
    return {
      names: nuxt.options._layers
        .filter(layer => layer.config.rootDir !== fixtureRoot)
        .map(layer => layer.meta?.name ?? basename(layer.config.rootDir))
        .sort(),
      alias: nuxt.options.alias,
    }
  }
  finally {
    await nuxt.close()
  }
}

describe('explicit web layer list', () => {
  it('finds layer packages among the app\'s dependencies', () => {
    expect([...packageLayers(fixtureRoot)]).toEqual([['delta', { name: '@fixture/delta', dir: packageRoot }]])
  })

  it('resolves listed ids to directories and packages in list order', () => {
    expect(listLayers(['delta', 'alpha', 'chat'], fixtureRoot)).toEqual([
      [packageRoot, { meta: { name: 'delta' } }],
      [join(fixtureRoot, 'layers/alpha'), { meta: { name: 'alpha' } }],
      [join(fixtureRoot, 'layers/chat'), { meta: { name: 'chat' } }],
    ])
  })

  it('fails naming every listed layer that is missing', () => {
    expect(() => layerListConfig(['alpha', 'nope', 'gone'], fixtureRoot)).toThrow(
      'Web layers listed by the product configuration could not be resolved: nope, gone.',
    )
  })

  it('registers exactly the listed layers, dropping unlisted directories', async () => {
    const glob = await registeredLayers({})
    expect(glob.names).toEqual(['alpha', 'beta', 'chat', 'gadget', 'overview'])

    const listed = await registeredLayers(layerListConfig(['alpha', 'chat', 'delta'], fixtureRoot))
    expect(listed.names).toEqual(['alpha', 'chat', 'delta'])
    expect(listed.alias['#layers/delta']).toBe(`${packageRoot}/`)
    expect(listed.alias['#layers/beta']).toBeUndefined()
  }, 60_000)

  it('lists every layer directory of this app in the product configuration', () => {
    const directories = readdirSync(join(webRoot, 'layers')).filter(name => hasNuxtConfig(join(webRoot, 'layers', name)))
    expect([...PRODUCT.layers].sort()).toEqual(directories.sort())
    expect(listLayers(PRODUCT.layers, webRoot).map(([dir]) => dir)).toEqual(PRODUCT.layers.map(id => join(webRoot, 'layers', id)))
  })
})
