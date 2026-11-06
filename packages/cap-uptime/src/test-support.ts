import type { ModuleDefinition } from '@candy-mountain/platform-sdk'
import { openTestDatabase, type PlatformDatabase, testProduct } from '@candy-mountain/platform-daemon'
import { uptimeDefinition } from './definition'

/** A module holding uptime, so grants and enablement behave as they do under a product. */
const TEST_MODULE: ModuleDefinition = { id: 'operations', label: 'Operations', description: 'Uptime.', icon: 'i-lucide-activity', capabilities: [{ capabilityId: 'uptime', defaultRung: 'manage' }] }

export const uptimeTestProduct = () => testProduct({ capabilities: [uptimeDefinition()], modules: [TEST_MODULE] })

export const openUptimeDatabase = (): PlatformDatabase => openTestDatabase({ definitions: [uptimeDefinition()] })
