import { join } from 'node:path'
import type { ProductConfig } from '@candy-mountain/platform-sdk'
import { addTemplate, defineNuxtModule } from 'nuxt/kit'
import { scopeRoutes } from '../scope-routes.mjs'

export interface PlatformWebOptions {
  /** The distribution's product configuration; the shell reads it as PRODUCT and never imports a product itself. */
  product?: ProductConfig
}

/** The virtual module shared/utils/product.ts reads; the template keeps plain unit tests free of Nuxt. */
export const PRODUCT_MODULE = '#platform-web/product'

export default defineNuxtModule<PlatformWebOptions>({
  meta: { name: 'platform-web', configKey: 'platformWeb' },
  setup({ product }, nuxt) {
    if (!product) {
      throw new Error('platformWeb.product is missing: the nuxt.config that extends @candy-mountain/platform-web must pass its ProductConfig.')
    }

    // Plain JS: Nitro's rollup does not transpile TypeScript under the build dir, which nuxt build keeps in node_modules/.cache.
    const template = addTemplate({
      filename: 'platform-web/product.js',
      write: true,
      getContents: () => `export const product = ${JSON.stringify(product, null, 2)}\n`,
    })
    addTemplate({
      filename: 'platform-web/product.d.ts',
      write: true,
      getContents: () => [
        `import type { ProductConfig } from '@candy-mountain/platform-sdk'`,
        `export declare const product: Readonly<ProductConfig>`,
        '',
      ].join('\n'),
    })
    nuxt.options.alias[PRODUCT_MODULE] = template.dst

    // Nuxt types module options for the node project only; a distribution's tests read nuxt.config from the app project.
    nuxt.hook('prepare:types', ({ references }) => {
      references.push({ path: join(nuxt.options.buildDir, 'types/modules.d.ts') })
    })

    nuxt.options.app.head.meta ||= []
    nuxt.options.app.head.meta.push({ name: 'theme-color', content: product.theme.hex })

    nuxt.hook('pages:extend', pages => scopeRoutes(pages, product.scope.urlPrefix))
  },
})
