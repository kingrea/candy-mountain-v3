import { fileURLToPath } from 'node:url'
import { createResolver } from 'nuxt/kit'
import { PLAYGROUND_PRODUCT } from './product'

const { resolve } = createResolver(import.meta.url)

export default defineNuxtConfig({
  extends: ['..'],
  platformWeb: { product: PLAYGROUND_PRODUCT, stylesheet: './theme.css' },
  // The package's tests are outside the playground, so nuxt typecheck needs them named.
  typescript: { tsConfig: { include: [resolve('../test/unit/**/*'), resolve('../layers/*/test/**/*')] } },
  // The package's eslint.config.mjs imports the generated config, so its globs are relative to the package.
  eslint: { config: { rootDir: fileURLToPath(new URL('..', import.meta.url)) } },
})
