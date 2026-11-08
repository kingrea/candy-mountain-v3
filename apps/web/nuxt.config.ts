import { fileURLToPath } from 'node:url'
import { CANDY_MOUNTAIN_DEVELOPMENT, CANDY_MOUNTAIN_DEVELOPMENT_PRODUCT, CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/candy-mountain'
import { layerListConfig, listLayers } from '@candy-mountain/platform-web/layer-list'

const root = fileURLToPath(new URL('.', import.meta.url))

// The product's list decides the layers: glob mode never registers a capability layer package.
const layerList = layerListConfig(CANDY_MOUNTAIN_PRODUCT.layers, root)

export default defineNuxtConfig({
  ...layerList,
  // Capability layers come first so they take priority over the shell, as globbed layers/ do.
  extends: [...layerList.extends, '@candy-mountain/platform-web'],
  $production: {
    platformWeb: { product: CANDY_MOUNTAIN_PRODUCT },
  },
  // Selected by NODE_ENV=development (nuxt dev); Nuxt concatenates its extends onto the list above, so only the development layers go here.
  $development: {
    hooks: layerListConfig(CANDY_MOUNTAIN_DEVELOPMENT_PRODUCT.layers, root).hooks,
    extends: listLayers(CANDY_MOUNTAIN_DEVELOPMENT.layers, root),
    platformWeb: { product: CANDY_MOUNTAIN_DEVELOPMENT_PRODUCT },
  },
})
