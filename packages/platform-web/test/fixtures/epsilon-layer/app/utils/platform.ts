import { CORE_LIMIT } from '@fixture/platform-web/app/utils/core'
import { useCoreThing } from '#layers/platform-web/app/composables/useCoreThing'
import { registerCorePanel } from '../../../platform-layer/app/utils/core'
import { renderLayerPage } from '@fixture/platform-web/test'

export function epsilonRegister() {
  registerCorePanel('epsilon', CORE_LIMIT + useCoreThing())
  return renderLayerPage
}
