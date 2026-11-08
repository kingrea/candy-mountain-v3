import type { ModuleDefinition } from '@candy-mountain/platform-sdk'
import { defineCapabilityDefinition, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import type { PlatformDatabase } from '@candy-mountain/platform-daemon'
import { openTestDatabase, testKit, testProduct, type TestKit } from '@candy-mountain/platform-daemon/testing'
import { uptimeDefinition, uptimeRoutes } from './definition'

/** A module holding uptime, so grants and enablement behave as they do under a product. */
const TEST_MODULE: ModuleDefinition = { id: 'operations', label: 'Operations', description: 'Uptime.', icon: 'i-lucide-activity', capabilities: [{ capabilityId: 'uptime', defaultRung: 'manage' }] }

export const uptimeTestProduct = () => testProduct({ capabilities: [uptimeDefinition()], modules: [TEST_MODULE] })

export const openUptimeDatabase = (): PlatformDatabase => openTestDatabase({ definitions: [uptimeDefinition()] })

/** Uptime without its scheduler, so a route test never checks a real target and a test may run a scheduler of its own. */
export const uptimeRoutesDefinition = (): CapabilityDefinition => defineCapabilityDefinition({ ...uptimeDefinition(), start: () => uptimeRoutes() })

/** The test kit over uptime's routes in the Operations module. */
export const uptimeRoutesKit = (): TestKit => testKit({ capabilities: [uptimeRoutesDefinition()], modules: [TEST_MODULE] })
