import { definePackageTestConfig } from '@candy-mountain/platform-config/vitest'

export default definePackageTestConfig('web', {
  include: ['test/unit/**/*.test.ts', 'layers/*/test/**/*.test.ts'],
  environment: 'node',
})
