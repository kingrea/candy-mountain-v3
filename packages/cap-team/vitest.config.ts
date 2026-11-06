import { definePackageTestConfig } from '@candy-mountain/platform-config/vitest'

export default definePackageTestConfig('cap-team', {
  include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'],
})
