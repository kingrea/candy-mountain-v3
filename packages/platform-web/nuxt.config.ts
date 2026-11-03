import { createResolver } from 'nuxt/kit'

const { resolve } = createResolver(import.meta.url)

const TSCONFIG_BASE = '@candy-mountain/platform-config/tsconfig.base.json'

// The shell is a Nuxt layer: a distribution extends it and hands over its product through the platformWeb module option.
export default defineNuxtConfig({
  $meta: { name: 'platform-web' },
  extends: ['./layers/chat', './layers/overview'],
  modules: ['@nuxt/eslint', '@nuxt/ui'],
  // Aliases in a layer's config resolve against the distribution, so the path is absolute.
  css: [resolve('./app/assets/css/main.css')],
  devtools: { enabled: false },
  devServer: { port: 4300 },
  runtimeConfig: {
    daemonUrl: '',
  },
  compatibilityDate: '2026-10-01',
  typescript: {
    tsConfig: { extends: TSCONFIG_BASE },
    serverTsConfig: { extends: TSCONFIG_BASE },
    sharedTsConfig: { extends: TSCONFIG_BASE },
    nodeTsConfig: { extends: TSCONFIG_BASE },
  },
  app: {
    head: {
      link: [
        // Served by server/routes/manifest.webmanifest.ts from the product configuration.
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
      ],
      script: [
        {
          // Hand-written worker in the distribution's public/sw.js; see its header for why no PWA module.
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
