import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/fixtures/alpha/schema.ts',
  out: './src/db/fixtures/alpha/migrations',
  strict: true,
})
