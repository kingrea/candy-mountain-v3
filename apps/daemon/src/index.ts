import { runDaemon } from '@candy-mountain/platform-daemon'
import { candyMountainProduct } from './candy-mountain'

await runDaemon(candyMountainProduct())
