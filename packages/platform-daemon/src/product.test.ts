import { existsSync } from 'node:fs'
import type { ModuleDefinition } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureDefinition } from './capabilities/fixtures'
import { startPlatform } from './platform'
import { fixturePluginType } from './plugins/fixtures'
import { assertProduct, ProductError, type Product } from './product'
import { createTempDataDir, testProduct, type TempDataDir } from './testing'

const operations: ModuleDefinition = { id: 'operations', label: 'Operations', description: 'Ops.', icon: 'i-lucide-activity', capabilities: [{ capabilityId: 'widgets', defaultRung: 'read' }] }
const WIDGETS = testProduct({ capabilities: [fixtureDefinition('widgets'), fixtureDefinition('gadgets', { manifest: null, pluginTypes: [fixturePluginType('gizmo')] })], modules: [operations], pluginTypes: [fixturePluginType('jira')] }, { name: 'Widgets' })
const configured = (config: Partial<Product['config']>): Product => ({ ...WIDGETS, config: { ...WIDGETS.config, ...config } })

describe('product configuration at boot', () => {
  let temp: TempDataDir
  afterEach(() => temp?.cleanup())

  const refuses = (product: Product, message: string) => {
    temp = createTempDataDir()
    expect(() => startPlatform(temp.root, { product })).toThrow(ProductError)
    expect(() => startPlatform(temp.root, { product })).toThrow(message)
    expect(existsSync(temp.root)).toBe(false)
  }

  it('accepts a product whose configuration lists what its parts supply, and keeps the product on the platform', async () => {
    expect(WIDGETS.config).toMatchObject({ capabilities: ['widgets', 'gadgets'], modules: ['operations'], pluginTypes: ['jira', 'gizmo'] })
    expect(() => assertProduct(WIDGETS)).not.toThrow()
    temp = createTempDataDir()
    const platform = startPlatform(temp.root, { product: WIDGETS })
    expect(platform.product.config.name).toBe('Widgets')
    expect(platform.pluginTypes.ids()).toEqual(['jira', 'gizmo'])
    await platform.close()
  })

  it.each([
    ['capability no definition supplies', { capabilities: [...WIDGETS.config.capabilities, 'ghost'] }, 'capability \'ghost\' is listed but no definition supplies it'],
    ['module not supplied', { modules: [...WIDGETS.config.modules, 'ghost'] }, 'module \'ghost\' is listed but no module definition supplies it'],
    ['plugin type not supplied', { pluginTypes: [...WIDGETS.config.pluginTypes, 'ghost'] }, 'plugin type \'ghost\' is listed but no definition or product plugin type supplies it'],
  ])('refuses a configuration naming a %s', (_, config, message) => {
    refuses(configured(config), `Product 'Widgets' configuration does not match the daemon: ${message}.`)
  })

  it.each([
    ['capability', { capabilities: ['widgets'] }, 'capability \'gadgets\' is supplied but not listed'],
    ['module', { modules: [] }, 'module \'operations\' is supplied but not listed'],
    ['plugin type', { pluginTypes: ['jira'] }, 'plugin type \'gizmo\' is supplied but not listed'],
  ])('refuses a %s supplied but left out of the configuration', (_, config, message) => {
    refuses(configured(config), message)
  })

  it('names every mismatch at once', () => {
    refuses(configured({ name: 'Home', capabilities: ['gadgets'], modules: [] }), 'Product \'Home\' configuration does not match the daemon: capability \'widgets\' is supplied but not listed; module \'operations\' is supplied but not listed.')
  })
})
