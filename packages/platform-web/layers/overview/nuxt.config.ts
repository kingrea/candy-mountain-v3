export default defineNuxtConfig({
  // Named so the layer keeps its #layers/overview alias when the shell is extended as a package.
  $meta: { name: 'overview' },
  components: [{ path: './components', prefix: 'Overview' }],
})
