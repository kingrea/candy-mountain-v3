import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  // The product package ships TypeScript source, so it is bundled; the installed capabilities are built and stay imports.
  deps: { alwaysBundle: [/^@candy-mountain\//] },
})
