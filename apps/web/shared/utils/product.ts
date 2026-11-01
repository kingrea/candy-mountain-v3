import { CANDY_MOUNTAIN_PRODUCT, type ProductConfig } from '@candy-mountain/shared'

// The shell's only reference to a specific product: nuxt.config, app.config, pages and
// server routes all read this, so a distribution swaps the product here.
export const PRODUCT: Readonly<ProductConfig> = CANDY_MOUNTAIN_PRODUCT
