import { definePackageTestConfig } from '@crab-shack/platform-config/vitest'

export default definePackageTestConfig('cap-bots', {
  include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
})
