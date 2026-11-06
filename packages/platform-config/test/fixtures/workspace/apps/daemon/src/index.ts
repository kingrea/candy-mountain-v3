import { alphaDefinition } from '@candy-mountain/cap-alpha'
import { start } from '@candy-mountain/platform-core'
import { INTERNAL } from '@candy-mountain/platform-core/daemon'

export const daemon = [alphaDefinition(), start(), INTERNAL]
