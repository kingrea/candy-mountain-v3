import type { ProductConfig } from '@candy-mountain/platform-sdk'
import { product } from '#platform-web/product'

// The virtual module the platform-web Nuxt module writes from the distribution's platformWeb.product option:
// nuxt.config, app.config, pages and server routes all read this, and the shell never imports a product.
export const PRODUCT: Readonly<ProductConfig> = product
