import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Resolved by name rather than from import.meta.url, which points into a distribution's bundle once this package is bundled there.
export const PACKAGE_ROOT = dirname(dirname(createRequire(import.meta.url).resolve('@candy-mountain/cap-template')))

/** Migration folders are read from here, never bundled. */
export const srcPath = (...segments: string[]): string => join(PACKAGE_ROOT, 'src', ...segments)
