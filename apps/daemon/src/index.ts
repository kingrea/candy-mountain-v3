import { runDaemon } from '@crab-shack/platform-daemon'
import { candyMountainProduct } from './candy-mountain'

await runDaemon(candyMountainProduct())
