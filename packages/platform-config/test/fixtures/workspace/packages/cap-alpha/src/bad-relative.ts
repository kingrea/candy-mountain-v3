import { betaDefinition } from '../../cap-beta/src/index'
import { start } from '../../platform-core/src/daemon/index'
import { outside } from '../../../outside'

export const alpha = [betaDefinition(), start(), outside]
