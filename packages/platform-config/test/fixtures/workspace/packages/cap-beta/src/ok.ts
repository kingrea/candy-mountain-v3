import { alphaDefinition } from '@candy-mountain/cap-alpha'
import type { INTERNAL } from '@candy-mountain/platform-core'

export const beta: [ReturnType<typeof alphaDefinition>, typeof INTERNAL] = [alphaDefinition(), 'internal']
