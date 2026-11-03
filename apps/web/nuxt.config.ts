import { fileURLToPath } from 'node:url'
import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/platform-sdk'
import { layerListConfig } from '@candy-mountain/platform-web/layer-list'

// Inside this repo the layers/ directories are the list; CM_WEB_LAYERS=product builds from the product's list, as a distribution does.
const layerList = process.env.CM_WEB_LAYERS === 'product'
  ? layerListConfig(CANDY_MOUNTAIN_PRODUCT.layers, fileURLToPath(new URL('.', import.meta.url)))
  : { extends: [] }

export default defineNuxtConfig({
  ...layerList,
  // Capability layers come first so they take priority over the shell, as globbed layers/ do.
  extends: [...layerList.extends, '@candy-mountain/platform-web'],
  platformWeb: { product: CANDY_MOUNTAIN_PRODUCT },
})
