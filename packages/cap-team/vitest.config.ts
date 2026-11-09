import { definePackageTestConfig } from '@crab-shack/platform-config/vitest'
import { layerTestConfig } from '@crab-shack/platform-web/test/vitest'
import { mergeConfig } from 'vitest/config'

export default mergeConfig(
  definePackageTestConfig('cap-team', {
    include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'],
  }),
  layerTestConfig(import.meta.url),
)
