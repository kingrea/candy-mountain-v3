import { existsSync } from 'node:fs'
import { CANDY_MOUNTAIN_SETTINGS } from '@candy-mountain/candy-mountain'
import { BOTS_SETTINGS } from '@crab-shack/cap-bots'
import { isCapabilityDefinition, productSettings, ProductError, startPlatform, type Product } from '@crab-shack/platform-daemon'
import { createTempDataDir, type TempDataDir } from '@crab-shack/platform-daemon/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { CANDY_MOUNTAIN, candyMountainProduct } from './candy-mountain'

const botsSettings = (product: Product) => productSettings(product, product.capabilities.filter(isCapabilityDefinition)).get('bots')

describe('the bots settings', () => {
  let temp: TempDataDir | undefined
  afterEach(() => {
    temp?.cleanup()
    temp = undefined
  })

  it('are supplied by the product at the declared defaults', () => {
    const defaults = Object.fromEntries(Object.entries(BOTS_SETTINGS).map(([key, declaration]) => [key, declaration.default]))
    expect(CANDY_MOUNTAIN_SETTINGS.bots).toEqual(defaults)
    expect(botsSettings(CANDY_MOUNTAIN)).toEqual({ worktreesPerProject: 4, worktreeIdleTimeoutMs: 7_200_000, worktreeReclaimIntervalMs: 600_000 })
    expect(botsSettings(candyMountainProduct({}, { CM_WORKTREES_PER_PROJECT: '', CM_WORKTREE_IDLE_TIMEOUT: '' }))).toEqual(botsSettings(CANDY_MOUNTAIN))
  })

  it('take each environment variable over the product, in the formats it always accepted', () => {
    expect(botsSettings(candyMountainProduct({}, { CM_WORKTREES_PER_PROJECT: '2' }))).toMatchObject({ worktreesPerProject: 2, worktreeIdleTimeoutMs: 7_200_000 })
    expect(botsSettings(candyMountainProduct({}, { CM_WORKTREE_IDLE_TIMEOUT: '30m', CM_WORKTREE_RECLAIM_INTERVAL: '45s' }))).toEqual({ worktreesPerProject: 4, worktreeIdleTimeoutMs: 1_800_000, worktreeReclaimIntervalMs: 45_000 })
    expect(botsSettings(candyMountainProduct({}, { CM_WORKTREE_IDLE_TIMEOUT: '30d', CM_WORKTREE_RECLAIM_INTERVAL: '1h' }))).toMatchObject({ worktreeIdleTimeoutMs: 2_592_000_000, worktreeReclaimIntervalMs: 3_600_000 })
  })

  it.each([
    ['CM_WORKTREES_PER_PROJECT', '0', 'worktreesPerProject', 'a positive integer'],
    ['CM_WORKTREES_PER_PROJECT', 'two', 'worktreesPerProject', 'a positive integer'],
    ['CM_WORKTREE_IDLE_TIMEOUT', '2 hours', 'worktreeIdleTimeoutMs', 'a duration such as 90s, 15m or 2h, at most 30d'],
    ['CM_WORKTREE_IDLE_TIMEOUT', '31d', 'worktreeIdleTimeoutMs', 'a duration such as 90s, 15m or 2h, at most 30d'],
    ['CM_WORKTREE_RECLAIM_INTERVAL', '0m', 'worktreeReclaimIntervalMs', 'a duration such as 90s, 15m or 2h, at most 30d'],
  ])('refuse %s=%s, naming bots and the key', (name, value, key, expected) => {
    expect(() => candyMountainProduct({}, { [name]: value })).toThrow(ProductError)
    expect(() => candyMountainProduct({}, { [name]: value })).toThrow(`Capability 'bots' setting '${key}': ${name} must be ${expected}, got "${value}".`)
  })

  it('stop the platform at boot when the product supplies a bad one, naming bots and the key', () => {
    temp = createTempDataDir()
    const product: Product = { ...CANDY_MOUNTAIN, settings: { bots: { ...CANDY_MOUNTAIN_SETTINGS.bots, worktreesPerProject: 0, worktreeIdleTimeout: '2h' } } }
    expect(() => startPlatform(temp!.root, { product })).toThrow("Product 'Candy Mountain' settings do not match its capabilities: capability 'bots' setting 'worktreeIdleTimeout' is not one it declares; capability 'bots' setting 'worktreesPerProject' must be a whole number of at least 1, not 0.")
    expect(existsSync(temp.root)).toBe(false)
  })
})
