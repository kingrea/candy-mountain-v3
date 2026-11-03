import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/uptime/schema/index.ts',
  out: './src/uptime/migrations',
  strict: true,
})
