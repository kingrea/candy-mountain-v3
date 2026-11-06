import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  components: [{ path: './components', prefix: 'Issues' }],
  // The distribution's nuxt typecheck covers app/ already; the layer's own tests are outside it.
  typescript: { tsConfig: { include: [fileURLToPath(new URL('./test/**/*', import.meta.url))] } },
})
