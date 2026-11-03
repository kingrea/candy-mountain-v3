import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/team/schema/index.ts',
  out: './src/team/migrations',
  strict: true,
})
