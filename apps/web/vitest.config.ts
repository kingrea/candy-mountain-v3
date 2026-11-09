import { definePackageTestConfig } from '@crab-shack/platform-config/vitest'

export default definePackageTestConfig('web', {
  include: ['test/unit/**/*.test.ts'],
  environment: 'node',
})
