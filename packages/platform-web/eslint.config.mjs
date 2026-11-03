import base from '@candy-mountain/platform-config/eslint'
import { layerBoundaries } from './eslint/layer-boundaries.mjs'
import withNuxt from './playground/.nuxt/eslint.config.mjs'

export default withNuxt(
  ...base,
  // Fixtures break the layer rules on purpose; test/unit/layer-boundaries.test.ts lints them.
  { ignores: ['test/fixtures/**'] },
  layerBoundaries(import.meta.url),
)
