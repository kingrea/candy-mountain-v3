import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/platform-sdk'
import { dataPaths } from '@candy-mountain/platform-daemon'
import { defineConfig } from 'drizzle-kit'
import { resolveDataDir } from './src/config'

// Studio only: each capability's set carries its own config for generate and check.
export default defineConfig({
  dialect: 'sqlite',
  dbCredentials: { url: dataPaths(resolveDataDir(CANDY_MOUNTAIN_PRODUCT)).database },
  strict: true,
})
