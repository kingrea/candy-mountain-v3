import { definePackageTestConfig } from '@candy-mountain/platform-config/vitest'

export default definePackageTestConfig('cap-chat-claude-code', {
  include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
})
