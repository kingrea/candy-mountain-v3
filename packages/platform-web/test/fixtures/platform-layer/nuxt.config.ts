export default defineNuxtConfig({
  $meta: { name: 'platform-web' },
  extends: ['./layers/chat', './layers/overview'],
  css: ['./app/assets/css/main.css'],
})
