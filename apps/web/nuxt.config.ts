export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  devServer: { port: 4300 },
  runtimeConfig: {
    daemonUrl: '',
  },
  compatibilityDate: '2026-10-01',
  app: {
    head: {
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
      ],
      meta: [{ name: 'theme-color', content: '#ec4899' }],
      script: [
        {
          // Hand-written worker in public/sw.js; see its header for why no PWA module.
          innerHTML:
            "if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('/sw.js'))",
          tagPosition: 'bodyClose',
        },
      ],
    },
  },
  icon: {
    // /api belongs to the daemon proxy.
    localApiEndpoint: '/_nuxt_icon',
  },
})
