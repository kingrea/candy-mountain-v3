import type { ViteUserConfig } from 'vitest/config'

/**
 * The vitest config a layer package merges into its own so its tests can render pages through
 * `@candy-mountain/platform-web/test`. `configUrl` is the package's `vitest.config` `import.meta.url`.
 */
export function layerTestConfig(configUrl: string): ViteUserConfig
