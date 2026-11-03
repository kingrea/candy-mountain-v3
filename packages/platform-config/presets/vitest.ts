import { defineConfig, type ViteUserConfig } from 'vitest/config'

type TestOptions = NonNullable<ViteUserConfig['test']>

export function definePackageTestConfig(name: string, test: TestOptions = {}) {
  return defineConfig({ test: { name, include: ['src/**/*.test.ts'], ...test } })
}
