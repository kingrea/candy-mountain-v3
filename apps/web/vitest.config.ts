import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'web',
    include: ['test/unit/**/*.test.ts', 'layers/*/test/**/*.test.ts'],
    environment: 'node',
  },
})
