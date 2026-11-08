export default defineNuxtConfig({
  components: [{ path: './components', prefix: 'Delta' }],
  css: ['./app/assets/delta.css'],
  $production: {
    css: ['~/assets/delta.css'],
  },
})
