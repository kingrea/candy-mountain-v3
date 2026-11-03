import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Must stay directly under src/ so the same relative URL resolves from source and from the bundled dist/index.mjs.
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Under src/ whether running from source or from dist; migration folders are read from here, never bundled. */
export const srcPath = (...segments: string[]): string => join(PACKAGE_ROOT, 'src', ...segments)
