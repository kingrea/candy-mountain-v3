import { definePackageTestConfig } from '@candy-mountain/platform-config/vitest'

export default definePackageTestConfig('cap-chat-codex', {
  include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
})
