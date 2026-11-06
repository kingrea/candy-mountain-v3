import { definePackageTestConfig } from '@candy-mountain/platform-config/vitest'

export default definePackageTestConfig('cap-issues', {
  include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
})
