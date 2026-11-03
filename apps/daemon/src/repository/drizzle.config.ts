import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/repository/schema/index.ts',
  out: './src/repository/migrations',
  strict: true,
})
