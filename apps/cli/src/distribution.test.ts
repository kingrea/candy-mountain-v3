import { describe, expect, it } from 'vitest'
import { candyMountain } from './distribution'

describe('candyMountain', () => {
  it('runs the apps this repository builds', () => {
    const distribution = candyMountain('/repo')
    expect(distribution).toMatchObject({
      product: { name: 'Candy Mountain' },
      cliEntry: '/repo/apps/cli/dist/index.mjs',
      root: '/repo',
      daemon: { entry: '/repo/apps/daemon/dist/index.mjs', cwd: '/repo/apps/daemon' },
      web: { entry: '/repo/apps/web/.output/server/index.mjs', cwd: '/repo/apps/web' },
    })
    expect(distribution.dataDir({ XDG_DATA_HOME: '/xdg' })).toBe('/xdg/candy-mountain')
  })
})
