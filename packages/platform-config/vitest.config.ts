import { definePackageTestConfig } from '@candy-mountain/platform-config/vitest'

export default definePackageTestConfig('platform-config', { include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'] })
