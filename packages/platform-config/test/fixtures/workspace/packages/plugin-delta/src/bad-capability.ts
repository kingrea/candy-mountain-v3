import { alphaDefinition } from '@candy-mountain/cap-alpha/src/index'
import { betaDefinition } from '@candy-mountain/cap-beta'
import { start } from '../../platform-core/src/daemon/index'

export const delta = [alphaDefinition(), betaDefinition(), start()]
