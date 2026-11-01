import { existsSync } from 'node:fs'
import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { CANDY_MOUNTAIN } from './candy-mountain'
import { startPlatform } from './platform'
import { assertProduct, ProductError, type Product } from './product'
import { createTempDataDir, type TempDataDir } from './testing'

const configured = (config: Partial<Product['config']>): Product => ({ ...CANDY_MOUNTAIN, config: { ...CANDY_MOUNTAIN_PRODUCT, ...config } })

describe('product configuration at boot', () => {
  let temp: TempDataDir
  afterEach(() => temp?.cleanup())

  const refuses = (product: Product, message: string) => {
    temp = createTempDataDir()
    expect(() => startPlatform(temp.root, { product })).toThrow(ProductError)
    expect(() => startPlatform(temp.root, { product })).toThrow(message)
    expect(existsSync(temp.root)).toBe(false)
  }

  it('accepts Candy Mountain as configured and keeps the product on the platform', async () => {
    expect(() => assertProduct(CANDY_MOUNTAIN)).not.toThrow()
    temp = createTempDataDir()
    const platform = startPlatform(temp.root, { product: CANDY_MOUNTAIN })
    expect(platform.product.config.name).toBe('Candy Mountain')
    await platform.close()
  })

  it.each([
    ['capability no definition supplies', { capabilities: [...CANDY_MOUNTAIN_PRODUCT.capabilities, 'ghost'] }, 'capability \'ghost\' is listed but no definition supplies it'],
    ['module not supplied', { modules: [...CANDY_MOUNTAIN_PRODUCT.modules, 'ghost'] }, 'module \'ghost\' is listed but no module definition supplies it'],
    ['plugin type not supplied', { pluginTypes: [...CANDY_MOUNTAIN_PRODUCT.pluginTypes, 'ghost'] }, 'plugin type \'ghost\' is listed but no definition or product plugin type supplies it'],
  ])('refuses a configuration naming a %s', (_, config, message) => {
    refuses(configured(config), `Product 'Candy Mountain' configuration does not match the daemon: ${message}.`)
  })

  it.each([
    ['capability', { capabilities: CANDY_MOUNTAIN_PRODUCT.capabilities.filter(id => id !== 'uptime') }, 'capability \'uptime\' is supplied but not listed'],
    ['module', { modules: CANDY_MOUNTAIN_PRODUCT.modules.filter(id => id !== 'operations') }, 'module \'operations\' is supplied but not listed'],
    ['plugin type', { pluginTypes: CANDY_MOUNTAIN_PRODUCT.pluginTypes.filter(id => id !== 'repository') }, 'plugin type \'repository\' is supplied but not listed'],
  ])('refuses a %s supplied but left out of the configuration', (_, config, message) => {
    refuses(configured(config), message)
  })

  it('names every mismatch at once', () => {
    refuses(configured({ name: 'Home', capabilities: ['overview'], modules: [] }), 'Product \'Home\' configuration does not match the daemon: capability \'issues\' is supplied but not listed;')
    expect(() => startPlatform(temp.root, { product: configured({ modules: [] }) })).toThrow('module \'issues\' is supplied but not listed; module \'agent-hub\' is supplied but not listed; module \'operations\' is supplied but not listed.')
  })
})
