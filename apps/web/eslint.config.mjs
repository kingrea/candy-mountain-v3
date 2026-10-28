import withNuxt from './.nuxt/eslint.config.mjs'
import cmLayers from './eslint/layer-boundaries.mjs'

export default withNuxt(
  // Fixtures break the layer rules on purpose; test/unit/layer-boundaries.test.ts lints them.
  { ignores: ['test/fixtures/**'] },
  {
    name: 'cm/layer-boundaries',
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue}'],
    plugins: { 'cm-layers': cmLayers },
    rules: {
      'cm-layers/no-cross-layer-import': 'error',
      'cm-layers/no-cross-layer-auto-import': 'error',
      'cm-layers/layer-prefix': 'error',
      'cm-layers/layer-pages': 'error',
    },
  },
)
