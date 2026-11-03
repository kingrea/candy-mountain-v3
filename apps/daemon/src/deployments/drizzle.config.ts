import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/deployments/schema/index.ts',
  out: './src/deployments/migrations',
  strict: true,
})
