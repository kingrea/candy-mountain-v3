import { deltaDefinition } from '@fixture/delta'
import { EPSILON_LIMIT } from './wire'

export const epsilonDefinition = { id: 'epsilon', dependsOn: [deltaDefinition.id], limit: EPSILON_LIMIT }
