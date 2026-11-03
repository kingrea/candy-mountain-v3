import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/issues/schema/index.ts',
  out: './src/issues/migrations',
  strict: true,
})
