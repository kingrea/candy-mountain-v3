import base from '@candy-mountain/platform-config/eslint'
import { layerPackageConfig } from '@candy-mountain/platform-web/eslint'

export default layerPackageConfig(import.meta.url, ...base)
