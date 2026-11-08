import { alphaDefinition } from '@candy-mountain/cap-alpha'
import { INTERNAL } from '@candy-mountain/platform-core'
import { start } from '@candy-mountain/platform-core/daemon'
import { deltaDefinition } from './index'

export const delta = [alphaDefinition(), INTERNAL, start(), deltaDefinition()]
