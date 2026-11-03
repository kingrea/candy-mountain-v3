import type { ProductConfig } from '@candy-mountain/platform-sdk'
import { addTemplate, defineNuxtModule } from 'nuxt/kit'
import { scopeRoutes } from '../scope-routes.mjs'

export interface PlatformWebOptions {
  /** The distribution's product configuration; the shell reads it as PRODUCT and never imports a product itself. */
  product?: ProductConfig
}

declare module 'nuxt/schema' {
  interface NuxtConfig {
    platformWeb?: PlatformWebOptions
  }
  interface NuxtOptions {
    platformWeb?: PlatformWebOptions
  }
}

/** The virtual module shared/utils/product.ts reads; the template keeps plain unit tests free of Nuxt. */
export const PRODUCT_MODULE = '#platform-web/product'

export default defineNuxtModule<PlatformWebOptions>({
  meta: { name: 'platform-web', configKey: 'platformWeb' },
  setup({ product }, nuxt) {
    if (!product) {
      throw new Error('platformWeb.product is missing: the nuxt.config that extends @candy-mountain/platform-web must pass its ProductConfig.')
    }

    const template = addTemplate({
      filename: 'platform-web/product.ts',
      write: true,
      getContents: () => [
        `import type { ProductConfig } from '@candy-mountain/platform-sdk'`,
        `export const product: Readonly<ProductConfig> = ${JSON.stringify(product, null, 2)}`,
        '',
      ].join('\n'),
    })
    nuxt.options.alias[PRODUCT_MODULE] = template.dst

    nuxt.options.app.head.meta ||= []
    nuxt.options.app.head.meta.push({ name: 'theme-color', content: product.theme.hex })

    nuxt.hook('pages:extend', pages => scopeRoutes(pages, product.scope.urlPrefix))
  },
})
