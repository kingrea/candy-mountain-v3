import { alphaDefinition } from '@candy-mountain/cap-alpha/src/index'
import { betaDefinition } from '@candy-mountain/cap-beta'
import { INTERNAL } from '@candy-mountain/platform-core/src/internal'

export const daemon = [alphaDefinition(), betaDefinition(), INTERNAL]
