import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['apps/cli', 'apps/daemon', 'apps/web', 'packages/claude-acp', 'packages/config', 'packages/shared'],
  },
})
