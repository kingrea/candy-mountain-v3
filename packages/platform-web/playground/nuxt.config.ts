import { fileURLToPath } from 'node:url'
import { PLAYGROUND_PRODUCT } from './product'

export default defineNuxtConfig({
  extends: ['..'],
  platformWeb: { product: PLAYGROUND_PRODUCT },
  // The package's eslint.config.mjs imports the generated config, so its globs are relative to the package.
  eslint: { config: { rootDir: fileURLToPath(new URL('..', import.meta.url)) } },
})
