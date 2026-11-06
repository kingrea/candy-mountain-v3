import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/candy-mountain'
import { resolveDataDir } from '@candy-mountain/platform-config'
import { dataPaths } from '@candy-mountain/platform-daemon'
import { defineConfig } from 'drizzle-kit'

// Studio only: each capability package carries its own config for generate and check.
export default defineConfig({
  dialect: 'sqlite',
  dbCredentials: { url: dataPaths(resolveDataDir(CANDY_MOUNTAIN_PRODUCT)).database },
  strict: true,
})
