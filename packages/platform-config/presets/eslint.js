import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { packageBoundaries } from '../eslint/package-boundaries.mjs'

// Scoped to script files so a Nuxt package can extend it without its TypeScript parser taking over .vue files.
export default tseslint.config(
  { ignores: ['**/dist/**', '**/.output/**', '**/.nuxt/**', '**/node_modules/**'] },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  packageBoundaries(),
)
