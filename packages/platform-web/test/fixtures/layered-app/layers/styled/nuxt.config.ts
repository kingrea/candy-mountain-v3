export default defineNuxtConfig({
  components: [{ path: './components', prefix: 'Styled' }],
  css: ['./app/assets/styled.css'],
  $production: {
    css: ['~/assets/styled.css'],
  },
})
