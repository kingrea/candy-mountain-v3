import { definePackageTestConfig } from '@candy-mountain/platform-config/vitest'

export default definePackageTestConfig('plugin-claude-code', {
  include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
})
