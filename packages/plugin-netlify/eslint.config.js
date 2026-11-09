import base from '@crab-shack/platform-config/eslint'
import { layerPackageConfig } from '@crab-shack/platform-web/eslint'

export default layerPackageConfig(import.meta.url, ...base)
