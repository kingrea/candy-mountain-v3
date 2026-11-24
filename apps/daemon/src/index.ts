import { runDaemon } from '@crab-shack/platform-daemon'
import { refuseRenamedVariables } from '@crab-shack/platform-sdk'
import { candyMountainProduct } from './candy-mountain'
import { RENAMED_VARIABLES } from './settings'

refuseRenamedVariables(process.env, RENAMED_VARIABLES)
await runDaemon(candyMountainProduct({}, process.env))
