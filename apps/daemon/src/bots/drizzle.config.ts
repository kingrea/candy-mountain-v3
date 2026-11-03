import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/bots/schema/index.ts',
  out: './src/bots/migrations',
  strict: true,
})
