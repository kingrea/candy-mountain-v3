import { fileURLToPath } from 'node:url'

// Must stay directly under src/ so the same relative URL resolves from source and from the bundled dist/index.mjs.
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
