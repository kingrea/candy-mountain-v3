import { definePackageTestConfig } from '@candy-mountain/platform-config/vitest'

export default definePackageTestConfig('plugin-repository', {
  include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
})
