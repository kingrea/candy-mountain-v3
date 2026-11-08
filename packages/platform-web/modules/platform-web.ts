import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProductConfig } from '@candy-mountain/platform-sdk'
import { addTemplate, defineNuxtModule, resolveAlias } from 'nuxt/kit'
import { colorModeOptions } from '../color-mode.mjs'
import { assertDeclaredColors, productStylesEntry, readStylesheet } from '../product-stylesheet.mjs'
import { scopeListRoute, scopeRoutes } from '../scope-routes.mjs'

export interface PlatformWebOptions {
  /** The distribution's product configuration; the shell reads it as PRODUCT and never imports a product itself. */
  product?: ProductConfig
  /**
   * A stylesheet the distribution owns, absolute or relative to its root: compiled after the shell's, so it may declare
   * the colour scales its theme names, set fonts and override any shell variable. Not in ProductConfig, which the daemon reads.
   */
  stylesheet?: string
}

/** The virtual module shared/utils/product.ts reads; the template keeps plain unit tests free of Nuxt. */
export const PRODUCT_MODULE = '#platform-web/product'

/** The shell's own sheet, as its nuxt.config registers it. */
export const SHELL_STYLESHEET = fileURLToPath(new URL('../app/assets/css/main.css', import.meta.url))

export default defineNuxtModule<PlatformWebOptions>({
  meta: { name: 'platform-web', configKey: 'platformWeb' },
  setup({ product, stylesheet }, nuxt) {
    if (!product) {
      throw new Error('platformWeb.product is missing: the nuxt.config that extends @candy-mountain/platform-web must pass its ProductConfig.')
    }

    const sheet = stylesheet && resolve(nuxt.options.rootDir, resolveAlias(stylesheet))
    if (sheet && !existsSync(sheet)) throw new Error(`platformWeb.stylesheet ${sheet} does not exist.`)
    assertDeclaredColors(product.theme.colors, sheet ? { path: sheet, css: readStylesheet(sheet) } : undefined)
    if (sheet) {
      const at = nuxt.options.css.indexOf(SHELL_STYLESHEET)
      if (at < 0) throw new Error(`The shell's stylesheet ${SHELL_STYLESHEET} is not in the css option, so the product stylesheet has nothing to follow.`)
      const entry = addTemplate({
        filename: 'platform-web/styles.css',
        write: true,
        getContents: () => productStylesEntry(SHELL_STYLESHEET, sheet),
      })
      nuxt.options.css.splice(at, 1, entry.dst)
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

    nuxt.options.colorMode = Object.assign(nuxt.options.colorMode ?? {}, colorModeOptions(product.theme.colorMode)) as typeof nuxt.options.colorMode

    nuxt.options.app.head.meta ||= []
    nuxt.options.app.head.meta.push({ name: 'theme-color', content: product.theme.hex })

    nuxt.hook('pages:extend', (pages) => {
      scopeRoutes(pages, product.scope.urlPrefix)
      scopeListRoute(pages, product.scope.listPath)
    })
  },
})
