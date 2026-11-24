import { existsSync } from 'node:fs'
import { CANDY_MOUNTAIN_SETTINGS } from '@candy-mountain/candy-mountain'
import { WORKTREES_SETTINGS } from '@crab-shack/plugin-worktrees'
import { isCapabilityDefinition, PLATFORM_AGENT_AVATAR, productSettings, ProductError, startPlatform, type Product } from '@crab-shack/platform-daemon'
import { PLATFORM_RENAMED_VARIABLES, RenamedVariablesError } from '@crab-shack/platform-sdk'
import { createTempDataDir, type TempDataDir } from '@crab-shack/platform-daemon/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { CANDY_MOUNTAIN, candyMountainProduct } from './candy-mountain'
import { RENAMED_VARIABLES } from './settings'

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
    expect(worktreesSettings(candyMountainProduct({}, { CRAB_WORKTREES_PER_PROJECT: '', CRAB_WORKTREE_IDLE_TIMEOUT: '' }))).toEqual(worktreesSettings(CANDY_MOUNTAIN))
  })

  it('take each environment variable over the product, in the formats it always accepted', () => {
    expect(worktreesSettings(candyMountainProduct({}, { CRAB_WORKTREES_PER_PROJECT: '2' }))).toMatchObject({ maxPerWorkspace: 2, idleTimeoutMs: 7_200_000 })
    expect(worktreesSettings(candyMountainProduct({}, { CRAB_WORKTREE_IDLE_TIMEOUT: '30m', CRAB_WORKTREE_RECLAIM_INTERVAL: '45s' }))).toEqual({ maxPerWorkspace: 4, idleTimeoutMs: 1_800_000, reclaimIntervalMs: 45_000 })
    expect(worktreesSettings(candyMountainProduct({}, { CRAB_WORKTREE_IDLE_TIMEOUT: '30d', CRAB_WORKTREE_RECLAIM_INTERVAL: '1h' }))).toMatchObject({ idleTimeoutMs: 2_592_000_000, reclaimIntervalMs: 3_600_000 })
  })

  it.each([
    ['CRAB_WORKTREES_PER_PROJECT', '0', 'maxPerWorkspace', 'a positive integer'],
    ['CRAB_WORKTREES_PER_PROJECT', 'two', 'maxPerWorkspace', 'a positive integer'],
    ['CRAB_WORKTREE_IDLE_TIMEOUT', '2 hours', 'idleTimeoutMs', 'a duration such as 90s, 15m or 2h, at most 30d'],
    ['CRAB_WORKTREE_IDLE_TIMEOUT', '31d', 'idleTimeoutMs', 'a duration such as 90s, 15m or 2h, at most 30d'],
    ['CRAB_WORKTREE_RECLAIM_INTERVAL', '0m', 'reclaimIntervalMs', 'a duration such as 90s, 15m or 2h, at most 30d'],
  ])('refuse %s=%s, naming worktrees and the key', (name, value, key, expected) => {
    expect(() => candyMountainProduct({}, { [name]: value })).toThrow(ProductError)
    expect(() => candyMountainProduct({}, { [name]: value })).toThrow(`Capability 'worktrees' setting '${key}': ${name} must be ${expected}, got "${value}".`)
  })

  it.each([
    ['CM_WORKTREES_PER_PROJECT', 'CRAB_WORKTREES_PER_PROJECT'],
    ['CM_WORKTREE_IDLE_TIMEOUT', 'CRAB_WORKTREE_IDLE_TIMEOUT'],
    ['CM_WORKTREE_RECLAIM_INTERVAL', 'CRAB_WORKTREE_RECLAIM_INTERVAL'],
  ])('refuse the old name %s, naming %s, even beside the new one', (old, current) => {
    expect(() => candyMountainProduct({}, { [old]: '2' })).toThrow(RenamedVariablesError)
    expect(() => candyMountainProduct({}, { [old]: '2' })).toThrow(`${old} is now ${current}`)
    expect(() => candyMountainProduct({}, { [old]: '', [current]: '2' })).toThrow(`${old} is now ${current} (${current} is set too: remove ${old})`)
  })

  it('stop the platform at boot when the product supplies a bad one, naming worktrees and the key', () => {
    temp = createTempDataDir()
    const product: Product = { ...CANDY_MOUNTAIN, settings: { worktrees: { ...CANDY_MOUNTAIN_SETTINGS.worktrees, maxPerWorkspace: 0, idleTimeout: '2h' } } }
    expect(() => startPlatform(temp!.root, { product })).toThrow("Product 'Candy Mountain' settings do not match its capabilities: capability 'worktrees' setting 'idleTimeout' is not one it declares; capability 'worktrees' setting 'maxPerWorkspace' must be a whole number of at least 1, not 0.")
    expect(existsSync(temp.root)).toBe(false)
  })
})

describe('the platform agent settings', () => {
  it('tell the agent what Candy Mountain is and to say issue, never bead, and draw it as the mountain', () => {
    expect(productSettings(CANDY_MOUNTAIN, CANDY_MOUNTAIN.capabilities.filter(isCapabilityDefinition)).get('platform-agent')).toEqual({
      about: 'Candy Mountain is a platform for managing codebases.',
      instructions: ['Say "issue", never "bead".'],
      avatar: 'i-lucide-mountain',
    })
    expect(PLATFORM_AGENT_AVATAR).not.toBe('i-lucide-mountain')
  })
})

describe('the renamed variables the entry point refuses', () => {
  it('are the platform\'s, plugin-acp\'s, plugin-uptime\'s and Candy Mountain\'s own, each old CM_ name to its CRAB_ name', () => {
    expect(Object.keys(RENAMED_VARIABLES)).toEqual(expect.arrayContaining([
      ...Object.keys(PLATFORM_RENAMED_VARIABLES),
      'CM_SESSION_IDLE_TIMEOUT',
      'CM_SESSION_MAX_LIVE',
      'CM_SESSION_INSTRUCTIONS_TIMEOUT',
      'CM_DECISION_TIMEOUT',
      'CM_UPTIME_HISTORY_MAX',
      'CM_UPTIME_HISTORY_MAX_AGE',
      'CM_WORKTREES_PER_PROJECT',
      'CM_WORKTREE_IDLE_TIMEOUT',
      'CM_WORKTREE_RECLAIM_INTERVAL',
    ]))
    expect(Object.keys(RENAMED_VARIABLES)).toHaveLength(Object.keys(PLATFORM_RENAMED_VARIABLES).length + 9)
    for (const [old, current] of Object.entries(RENAMED_VARIABLES)) expect(current).toBe(old.replace(/^CM_/, 'CRAB_'))
  })
})
