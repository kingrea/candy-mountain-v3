import { runDaemon } from '@candy-mountain/platform-daemon'
import { candyMountainDevelopmentProduct } from './development'

await runDaemon(candyMountainDevelopmentProduct())
