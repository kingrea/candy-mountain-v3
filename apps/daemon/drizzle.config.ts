import { defineConfig } from 'drizzle-kit'
import { resolveDataDir } from './src/config'
import { dataPaths } from './src/data-dir'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: { url: dataPaths(resolveDataDir()).database },
  strict: true,
})
