import { INTERNAL } from '@candy-mountain/platform-core'
import { start } from '@candy-mountain/platform-core/daemon'
import { alphaDefinition } from './index'
import { readFileSync } from 'node:fs'
import { z } from 'zod'

export const alpha = [INTERNAL, start(), alphaDefinition(), readFileSync, z]
