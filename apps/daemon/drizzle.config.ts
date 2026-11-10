import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/candy-mountain'
import { resolveDataDir } from '@crab-shack/platform-config'
import { dataPaths } from '@crab-shack/platform-daemon'
import { defineConfig } from 'drizzle-kit'

// Studio only: each capability package carries its own config for generate and check.
export default defineConfig({
  dialect: 'sqlite',
  dbCredentials: { url: dataPaths(resolveDataDir(CANDY_MOUNTAIN_PRODUCT), CANDY_MOUNTAIN_PRODUCT.name).database },
  strict: true,
})
