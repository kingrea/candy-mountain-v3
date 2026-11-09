import { definePackageTestConfig } from '@crab-shack/platform-config/vitest'

export default definePackageTestConfig('cap-deployments', {
  include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
})
