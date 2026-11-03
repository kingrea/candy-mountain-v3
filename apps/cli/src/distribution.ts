import { join } from 'node:path'
import { resolveDataDir } from '@candy-mountain/platform-config'
import type { Distribution } from '@candy-mountain/platform-cli'
import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/platform-sdk'

export function candyMountain(repoRoot: string): Distribution {
  return {
    product: CANDY_MOUNTAIN_PRODUCT,
    cliEntry: join(repoRoot, 'apps', 'cli', 'dist', 'index.mjs'),
    root: repoRoot,
    daemon: { entry: join(repoRoot, 'apps', 'daemon', 'dist', 'index.mjs'), cwd: join(repoRoot, 'apps', 'daemon') },
    web: { entry: join(repoRoot, 'apps', 'web', '.output', 'server', 'index.mjs'), cwd: join(repoRoot, 'apps', 'web') },
    dataDir: (env) => resolveDataDir(CANDY_MOUNTAIN_PRODUCT, env),
  }
}
