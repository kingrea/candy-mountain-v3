# Testing a capability against the daemon platform

`@candy-mountain/platform-daemon/testing` is the daemon test kit: the one entry a capability's tests import test support from. A capability package (`cap-*` or `plugin-*`) tests itself from its own root, with its own definition and the platform packages alone: never a distribution (`apps/daemon`, `apps/web`), never a platform internal path. The package-boundary lint (`cm-packages/no-distribution-import`, `cm-packages/no-subpath-import`) refuses both.

## Where it lives, and why

The kit is a second export of the daemon platform package, not of the SDK. Starting a platform needs the daemon platform's start function, and the daemon platform already depends on the SDK, so a test entry on the SDK that reached back into the daemon would make the two packages depend on each other: Turborepo refuses a cyclic workspace graph and the boundary lint would have nothing honest to say about the direction. The SDK stays the contract a capability writes against; the package that boots the contract is the one that can boot it for a test.

The production root entry (`@candy-mountain/platform-daemon`) exports no test support. What a capability's own code uses from the root stays importable in its tests (the functions and types under test); test support, fixtures and harnesses come from `/testing` only.

## The kit

```ts
import { testKit, type TestKit } from '@candy-mountain/platform-daemon/testing'

const kit = testKit({ capabilities: [myDefinition()], pluginTypes: [], modules: [], facts: ['hasThing'] })
const workspace = kit.workspace({ facts: { hasThing: true } })
const reader = kit.actor({ rungs: { mine: 'read' } })
const res = await reader.request(`/workspaces/${workspace.slug}/mine`)
await kit.close()
```

**`testKit(options)`** starts a platform in a fresh temporary data directory over the platform's own definitions plus the capabilities, modules and plugin types named (`startTestPlatform` with a product built from the parts, or a whole `product`), and builds the app a distribution would serve over it. Every option of `startPlatform` is accepted (`families`, `notifications`, `migrationsFolder`). Secrets are unlocked with a throwaway key, so plugin secrets can be written without `CM_SECRETS_KEY`; `lockedSecrets: true` starts as a daemon without the key does. `facts` declares workspace facts through a service-only definition (`TEST_FACTS_ID`) so a manifest under test may require a fact no listed definition declares; they are false until a workspace sets them. It never boots a product's definitions you did not list, and it never reads the environment.

- `kit.platform` is the started `Platform`: registries, `runtime.service(KEY)` for the services the definitions bound, `secrets` (readable), `paths`. `kit.db` is its database.
- `kit.app` is the Hono app over it, with the definitions' routes mounted. It authenticates every request from the `TEST_ACTOR_HEADER` header (`x-test-actor`), which names a username; a request without it is a 401.
- `kit.admin` is the seeded administrator, who holds the top rung of every capability.
- `kit.deps` is what the app hands the plugin-instance functions and a definition's services (`db`, `paths`, `pluginTypes`, the write-only `secrets` and the `secretsReader`), for a test calling `testPluginInstance` or a capability's own service directly.
- `kit.close()` closes the started definitions and the database, then removes the data directory. Call it in `afterEach`.

**`kit.actor({ rungs, username })`** makes a new user with a role of its own and a grant per capability named in `rungs` (`{ mine: 'read' }`), checked against the ladder so a bad rung name throws. A capability left out resolves to its `everyoneRung` or `none`. The result carries the resolved `actor`, `headers` to spread into any request, and `request(path, init)`, which is `kit.app.request` with the header set. Grants are platform-wide, as they are in a product; which workspaces the capability is enabled in is the workspace's business, below. It never signs anyone in through the password routes.

**`kit.workspace({ name, slug, facts, modules })`** creates a workspace row and enables modules in it: every registered module unless `modules` names the ones to enable (an empty list enables none, so a capability in a module is refused as not enabled). `facts` sets what the registry and the gates see for this workspace, over whatever the definitions compute; the override reaches the app's registry loader and `requireCapability`, not a definition that computes facts itself through its start context. It never creates files for the workspace; a capability that needs a checkout or a repository makes that itself.

**`kit.pluginInstance({ type, workspace, config, secrets, health })`** creates an instance of a registered plugin type, a workspace instance when `workspace` is given and a global one otherwise. Every secret field the type declares is filled with a fake value (`fake-<name>`) unless `secrets` names it (`null` leaves one unset); `config` goes through the type's validation as a real request would. The instance's stored health is `{ healthy: true }` unless `health` says otherwise (`null` leaves it untested, which the gate counts as not ready). It never runs the type's health check and never reaches the network.

**`kit.as(username)`** is the actor for a user that already exists: the seeded administrator, a user a capability's own code made, or one an earlier kit over the same data directory made.

**`kit.restart(options)`** is a daemon restart: it closes the kit's platform, keeps the data directory and the secrets key, and starts a new kit over them with `options` laid over the ones the first kit was given (other bins, other timeouts). Users, workspaces, plugin instances, secrets and the facts a workspace was given carry over; actors and the app belong to the kit that made them, so take them again from the new kit (`next.as(username)`). The new kit owns the directory: closing the old one afterwards removes nothing, and restarting a closed kit throws.

```ts
let kit = testKit({ capabilities: [myDefinition()] })
// ... write state through kit.admin
kit = await kit.restart()
// ... assert it was read back
```

## The lower-level helpers

Reachable through the same entry for a test that assembles its own app or registries:

- `openTestDatabase({ definitions, seed })`: an in-memory database with the platform set and the named definitions' sets applied and their activity event types registered; the admin is seeded unless `seed` is false.
- `createTempDataDir()` and `startTestPlatform(dataDir, options)`: the platform alone, from parts or a product; `platformApp(platform, deps)` the app over it; `createTestApp(deps)` an app over whatever registries, runtime and auth strategy a test passes, defaulting the product to `testProduct()`.
- `testProduct(parts, config)` and `TEST_PRODUCT_CONFIG`: a product with nothing of its own, whose configuration follows the parts given.
- `fixtureCapability(id, requiresPlugins)`, `fixtureDefinition(id, overrides)`, `fixtureCapabilityContext(db, overrides)`, `cloneManifest`, `undescribed`: valid manifests, definitions and a start context to build on or break; `fixturePluginType(id)`, `globalPluginType(id)`, `clonePluginType`, `multiPluginType(health)`: plugin types of each shape; `ALPHA_MIGRATION_SET`, `BETA_MIGRATION_SET`, `FIXTURE_MIGRATION_SETS`: two schema sets with one table each, beta referencing alpha.
- `instanceHarness(types, options)`: a database, an unlocked secrets store and an app for plugin-instance tests; `testAccess(db)`, `addRole(db, slug)`, `TEST_CAPABILITIES`, `TEST_MODULES`: registries and roles for grant tests.
- `startStubGateway(reply)` and `scriptedReply`: an LLM gateway speaking enough of the chat completions API for the platform agent.

The entry also re-exports the platform types a test names when it holds what the kit started (`Platform`, `PlatformDatabase`, `Db`, `Product`, `AppEnv`, `AuthStrategy`, `CapabilityDefinition`, `AnyPluginType`, `DataPaths`, `MigrationSet`).

## The distribution's tests

`apps/daemon/src/testing` wraps the kit with Candy Mountain's product and workspaces carrying a repository. Those wrappers are the distribution's own and import this entry like any other consumer; no capability package imports them.
