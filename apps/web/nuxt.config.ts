import { fileURLToPath } from 'node:url'
import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/candy-mountain'
import { layerListConfig } from '@crab-shack/platform-web/layer-list'

const root = fileURLToPath(new URL('.', import.meta.url))

// The product's list decides the layers: glob mode never registers a capability layer package.
const layerList = layerListConfig(CANDY_MOUNTAIN_PRODUCT.layers, root)

export default defineNuxtConfig({
  ...layerList,
  // Capability layers come first so they take priority over the shell, as globbed layers/ do.
  extends: [...layerList.extends, '@crab-shack/platform-web'],
  platformWeb: { product: CANDY_MOUNTAIN_PRODUCT },
  // The shell sets this itself from platform 0.8.1; every request is the admin in development, and under WSL nuxt dev otherwise binds every interface.
  devServer: { host: '127.0.0.1' },
  app: {
    head: {
      link: [{ key: 'candy-mountain-favicon', rel: 'icon', type: 'image/png', sizes: '64x64', href: '/brand/favicon-64.png' }],
    },
  },
})
