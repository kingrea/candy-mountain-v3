export default defineNuxtConfig({
  // Named so the layer keeps its #layers/chat alias when the shell is extended as a package.
  $meta: { name: 'chat' },
  components: [{ path: './components', prefix: 'Chat' }],
})
