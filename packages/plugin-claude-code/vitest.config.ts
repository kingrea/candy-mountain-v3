import { definePackageTestConfig } from '@crab-shack/platform-config/vitest'

export default definePackageTestConfig('plugin-claude-code', {
  include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
})
