import { fileURLToPath } from 'node:url'
import { layerListConfig } from './layer-list.mjs'
import { scopeRoutes } from './scope-routes.mjs'
import { PRODUCT } from './shared/utils/product'

// Inside this repo the layers/ directories are the list; CM_WEB_LAYERS=product builds from the product's list, as a distribution does.
const layerList = process.env.CM_WEB_LAYERS === 'product' ? layerListConfig(PRODUCT.layers, fileURLToPath(new URL('.', import.meta.url))) : {}

export default defineNuxtConfig({
  ...layerList,
  modules: ['@nuxt/eslint', '@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  devServer: { port: 4300 },
  runtimeConfig: {
    daemonUrl: '',
  },
  compatibilityDate: '2026-10-01',
  hooks: {
    'pages:extend': pages => scopeRoutes(pages, PRODUCT.scope.urlPrefix),
  },
  app: {
    head: {
      link: [
        // Served by server/routes/manifest.webmanifest.ts from the product configuration.
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
      ],
      meta: [{ name: 'theme-color', content: PRODUCT.theme.hex }],
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
