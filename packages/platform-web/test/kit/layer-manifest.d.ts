// The shape of the manifest layerTestConfig() in vitest.mjs serves in place of this module: the layer under test and the shell as the vitest config found them.
import type { ProductConfig } from '@candy-mountain/platform-sdk'
import type { Component } from 'vue'

/** The layer id, its package.json `webLayer`. */
export const id: string
/** The layer's components prefix, PascalCase of the id. */
export const prefix: string
/** The layer package's root directory. */
export const root: string
/** The platform web package's root directory. */
export const platform: string
/** The product the shell runs with: the playground's. */
export const product: ProductConfig
/** Every component of the shell, its layers and the layer under test, by registered name, as a lazy loader. */
export const components: Record<string, () => Promise<{ default: Component }>>
/** The layer's Nuxt plugins under app/plugins, as lazy loaders. */
export const plugins: (() => Promise<{ default: unknown }>)[]
/** Nuxt UI's component names, each stubbed. */
export const uiComponents: string[]
