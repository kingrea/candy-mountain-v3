import base from '@candy-mountain/platform-config/eslint'
import { layerBoundaries } from '@candy-mountain/platform-web/eslint'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(...base, layerBoundaries(import.meta.url))
