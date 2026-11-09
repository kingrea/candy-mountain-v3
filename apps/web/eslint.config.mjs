import base from '@crab-shack/platform-config/eslint'
import { layerBoundaries } from '@crab-shack/platform-web/eslint'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(...base, layerBoundaries(import.meta.url))
