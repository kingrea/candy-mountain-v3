// The daemon test kit: the one entry a capability's tests import test support from. See ../../TESTING.md.
export { testKit, TEST_ACTOR_HEADER, TEST_FACTS_ID, type TestActor, type TestActorOptions, type TestDeps, type TestKit, type TestKitOptions, type TestPluginInstanceOptions, type TestWorkspaceOptions } from './kit'
export { createTempDataDir, createTestApp, openTestDatabase, platformApp, startTestPlatform, type TempDataDir, type TestAppDeps, type TestDatabaseOptions, type TestPlatformOptions } from './platform'
export { TEST_PRODUCT_CONFIG, testProduct, type ProductParts } from './product'

// Fixtures: valid manifests, definitions and plugin types a test can break or build on.
export { cloneManifest, fixtureCapability, fixtureCapabilityContext, fixtureDefinition, undescribed } from '../capabilities/fixtures'
export { clonePluginType, fixturePluginType, globalPluginType } from '../plugins/fixtures'
export { ALPHA_MIGRATION_SET, BETA_MIGRATION_SET, FIXTURE_MIGRATION_SETS } from '../db/fixtures'

// Lower-level harnesses kept for tests that assemble their own app or registries.
export { instanceHarness, multiPluginType, type InstanceHarness, type InstanceHarnessOptions } from '../plugins/instances/test-support'
export { addRole, testAccess, TEST_CAPABILITIES, TEST_MODULES } from '../grants/test-access'
export { scriptedReply, startStubGateway, type StubGateway, type StubGatewayReply, type StubGatewayRequest } from '../platform-agent/test-support'

// The platform types a test names when it holds what the kit started.
export type { AppDeps, AppEnv } from '../app'
export type { AuthStrategy } from '../auth'
export type { CapabilityDefinition } from '../capabilities/definition'
export type { CapabilityRegistryEntry } from '../capabilities/registry'
export type { DataPaths } from '../data-dir'
export type { Db, MigrationSet, PlatformDatabase } from '../db'
export type { Platform, PlatformOptions } from '../platform'
export type { AnyPluginType } from '../plugins/definition'
export type { Product } from '../product'
