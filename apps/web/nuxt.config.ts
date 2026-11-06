import { fileURLToPath } from 'node:url'
import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/candy-mountain'
import { layerListConfig } from '@candy-mountain/platform-web/layer-list'

// The product's list decides the layers: glob mode never registers a capability layer package.
const layerList = layerListConfig(CANDY_MOUNTAIN_PRODUCT.layers, fileURLToPath(new URL('.', import.meta.url)))

export default defineNuxtConfig({
  ...layerList,
  // Capability layers come first so they take priority over the shell, as globbed layers/ do.
  extends: [...layerList.extends, '@candy-mountain/platform-web'],
  platformWeb: { product: CANDY_MOUNTAIN_PRODUCT },
})
