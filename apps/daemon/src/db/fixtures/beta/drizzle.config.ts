import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/fixtures/beta/schema.ts',
  out: './src/db/fixtures/beta/migrations',
  strict: true,
})
