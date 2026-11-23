import { existsSync } from 'node:fs'
import { CANDY_MOUNTAIN_SETTINGS } from '@candy-mountain/candy-mountain'
import { WORKTREES_SETTINGS } from '@crab-shack/plugin-worktrees'
import { isCapabilityDefinition, productSettings, ProductError, startPlatform, type Product } from '@crab-shack/platform-daemon'
import { createTempDataDir, type TempDataDir } from '@crab-shack/platform-daemon/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { CANDY_MOUNTAIN, candyMountainProduct } from './candy-mountain'

const worktreesSettings = (product: Product) => productSettings(product, product.capabilities.filter(isCapabilityDefinition)).get('worktrees')

describe('the worktrees settings', () => {
  let temp: TempDataDir | undefined
  afterEach(() => {
    temp?.cleanup()
    temp = undefined
  })

  it('are supplied by the product at the declared defaults', () => {
    const defaults = Object.fromEntries(Object.entries(WORKTREES_SETTINGS).map(([key, declaration]) => [key, declaration.default]))
    expect(CANDY_MOUNTAIN_SETTINGS.worktrees).toEqual(defaults)
    expect(worktreesSettings(CANDY_MOUNTAIN)).toEqual({ maxPerWorkspace: 4, idleTimeoutMs: 7_200_000, reclaimIntervalMs: 600_000 })
    expect(worktreesSettings(candyMountainProduct({}, { CM_WORKTREES_PER_PROJECT: '', CM_WORKTREE_IDLE_TIMEOUT: '' }))).toEqual(worktreesSettings(CANDY_MOUNTAIN))
  })

  it('take each environment variable over the product, in the formats it always accepted', () => {
    expect(worktreesSettings(candyMountainProduct({}, { CM_WORKTREES_PER_PROJECT: '2' }))).toMatchObject({ maxPerWorkspace: 2, idleTimeoutMs: 7_200_000 })
    expect(worktreesSettings(candyMountainProduct({}, { CM_WORKTREE_IDLE_TIMEOUT: '30m', CM_WORKTREE_RECLAIM_INTERVAL: '45s' }))).toEqual({ maxPerWorkspace: 4, idleTimeoutMs: 1_800_000, reclaimIntervalMs: 45_000 })
    expect(worktreesSettings(candyMountainProduct({}, { CM_WORKTREE_IDLE_TIMEOUT: '30d', CM_WORKTREE_RECLAIM_INTERVAL: '1h' }))).toMatchObject({ idleTimeoutMs: 2_592_000_000, reclaimIntervalMs: 3_600_000 })
  })

  it.each([
    ['CM_WORKTREES_PER_PROJECT', '0', 'maxPerWorkspace', 'a positive integer'],
    ['CM_WORKTREES_PER_PROJECT', 'two', 'maxPerWorkspace', 'a positive integer'],
    ['CM_WORKTREE_IDLE_TIMEOUT', '2 hours', 'idleTimeoutMs', 'a duration such as 90s, 15m or 2h, at most 30d'],
    ['CM_WORKTREE_IDLE_TIMEOUT', '31d', 'idleTimeoutMs', 'a duration such as 90s, 15m or 2h, at most 30d'],
    ['CM_WORKTREE_RECLAIM_INTERVAL', '0m', 'reclaimIntervalMs', 'a duration such as 90s, 15m or 2h, at most 30d'],
  ])('refuse %s=%s, naming worktrees and the key', (name, value, key, expected) => {
    expect(() => candyMountainProduct({}, { [name]: value })).toThrow(ProductError)
    expect(() => candyMountainProduct({}, { [name]: value })).toThrow(`Capability 'worktrees' setting '${key}': ${name} must be ${expected}, got "${value}".`)
  })

  it('stop the platform at boot when the product supplies a bad one, naming worktrees and the key', () => {
    temp = createTempDataDir()
    const product: Product = { ...CANDY_MOUNTAIN, settings: { worktrees: { ...CANDY_MOUNTAIN_SETTINGS.worktrees, maxPerWorkspace: 0, idleTimeout: '2h' } } }
    expect(() => startPlatform(temp!.root, { product })).toThrow("Product 'Candy Mountain' settings do not match its capabilities: capability 'worktrees' setting 'idleTimeout' is not one it declares; capability 'worktrees' setting 'maxPerWorkspace' must be a whole number of at least 1, not 0.")
    expect(existsSync(temp.root)).toBe(false)
  })
})

describe('the platform agent settings', () => {
  it('tell the agent what Candy Mountain is and to say issue, never bead', () => {
    expect(productSettings(CANDY_MOUNTAIN, CANDY_MOUNTAIN.capabilities.filter(isCapabilityDefinition)).get('platform-agent')).toEqual({
      about: 'Candy Mountain is a platform for managing codebases.',
      instructions: ['Say "issue", never "bead".'],
    })
  })
})
