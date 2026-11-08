import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MigrationSet } from '..'
import * as alpha from './alpha/schema'
import * as beta from './beta/schema'

const FIXTURES_DIR = fileURLToPath(new URL('.', import.meta.url))

// `fixture-beta` references `fixture-alpha`'s table, so order matters; regenerate with each folder's `drizzle.config.ts`.
export const ALPHA_MIGRATION_SET: MigrationSet = Object.freeze({ id: 'fixture-alpha', schema: alpha, migrationsFolder: join(FIXTURES_DIR, 'alpha', 'migrations') })
export const BETA_MIGRATION_SET: MigrationSet = Object.freeze({ id: 'fixture-beta', schema: beta, migrationsFolder: join(FIXTURES_DIR, 'beta', 'migrations') })
export const FIXTURE_MIGRATION_SETS: readonly MigrationSet[] = Object.freeze([ALPHA_MIGRATION_SET, BETA_MIGRATION_SET])

export { alpha, beta }
