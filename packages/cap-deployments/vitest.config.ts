import { definePackageTestConfig } from '@candy-mountain/platform-config/vitest'

export default definePackageTestConfig('cap-deployments', {
  include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
})
