import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'claude-acp',
    include: ['src/**/*.test.ts'],
  },
})
