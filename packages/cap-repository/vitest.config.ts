import { definePackageTestConfig } from '@candy-mountain/platform-config/vitest'

export default definePackageTestConfig('cap-repository', {
  include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
})
