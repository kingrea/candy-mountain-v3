import { fileURLToPath } from 'node:url'
import { definePackageTestConfig } from '@candy-mountain/platform-config/vitest'
import { mergeConfig } from 'vitest/config'
import { layerTestConfig } from './test/kit/vitest.mjs'

export default mergeConfig(
  mergeConfig(
    definePackageTestConfig('platform-web', {
      include: ['test/unit/**/*.test.ts', 'layers/*/test/**/*.test.ts'],
      environment: 'node',
    }),
    // Outside Nuxt the virtual product module is the playground's product.
    { resolve: { alias: { '#platform-web/product': fileURLToPath(new URL('./test/product.ts', import.meta.url)) } } },
  ),
  // The test kit's own test renders the zeta fixture layer's page through it.
  layerTestConfig(new URL('./test/fixtures/zeta-layer/', import.meta.url).href),
)
