import { expect, it } from 'vitest'
import { CORE_LIMIT } from '@fixture/platform-web/app/utils/core'
import { layerRegistry, renderLayerPage } from '@fixture/platform-web/test'
import { layerTestConfig } from '@fixture/platform-web/test/vitest'
import { registerCorePanel } from '../../../platform-layer/app/utils/core'
import Page from '../../app/pages/p/[project]/epsilon/index.vue'

it('renders', async () => {
  const page = await renderLayerPage(Page, { registry: layerRegistry({ access: 'denied' }) })
  expect(page.gate()).toBe('not-granted')
  expect([CORE_LIMIT, layerTestConfig, registerCorePanel]).toBeTruthy()
})
