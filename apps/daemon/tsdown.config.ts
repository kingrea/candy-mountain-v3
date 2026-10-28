import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  // Workspace packages ship TypeScript source, so they must be bundled rather than imported at runtime.
  deps: { alwaysBundle: [/^@candy-mountain\//] },
})
