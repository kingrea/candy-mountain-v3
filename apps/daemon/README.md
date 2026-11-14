# @candy-mountain/daemon

Candy Mountain's daemon distribution. It holds no platform code and no capability code: `src/index.ts` is `await runDaemon(candyMountainProduct({}, process.env))` (the build, and what `pnpm dev` runs under `tsx watch`), and the rest of `src/` is the product wiring and the product's own tests. The platform and every capability are installed packages. The platform's contract with a capability (the runtime definition, service lifecycle, schema ownership, the dependency declaration and what the platform keeps stable) is not described here: it is the platform's conventions document, `packages/platform-daemon/README.md` in the base repository (crab-shack/platform), also the README of the installed `@crab-shack/platform-daemon` package. How a capability behaves is not described here either: it is in the capability's own package ([Where each capability is documented](#where-each-capability-is-documented)). This README covers the distribution's shape, adding a capability to Candy Mountain, its variables and how the platform's subsystems behave in it.

## Shape

| Where | What |
|---|---|
| `@crab-shack/platform-daemon` (installed from the registry, pinned to one exact version) | The platform: data directory, database and the platform migration set, secrets, auth, workspaces and organisations, the capability, module and plugin type registries and plugin instances, grants, the registry and readiness, settings, activity, notifications, threads, the agent MCP host, Mastra, the platform-owned `threads`, `overview` and `platform-agent` definitions, the platform routes, `createApp`, `startPlatform`, and `runDaemon`/`loadDaemonConfig` (`src/daemon.ts`: reads the platform's variables, boots the product, logs what registered, serves it and shuts it down on SIGINT/SIGTERM). One root entry; nothing imports a subpath or a relative path into it. |
| `@crab-shack/cap-<id>` (installed from the registry, each pinned to its own exact version) | One package per capability: its definition factory and service keys on the root entry, its schema set and migrations, and its Nuxt layer. The package is built: the daemon imports its `dist/`, and its migrations and layer ship as source beside it. It never brings plugin types. |
| `@crab-shack/plugin-<id>` (installed the same way) | One connection package per plugin type: a service-only definition (no manifest) whose id is the plugin type's id, holding the type, its services and its Nuxt layer. |
| `packages/candy-mountain` (`@candy-mountain/candy-mountain`) | The product as plain data: `CANDY_MOUNTAIN_PRODUCT` (name, theme, scope label, URL prefix and list path, and the capability, module, plugin type and layer ids), `MODULES` (the module definitions) and `CANDY_MOUNTAIN_SETTINGS`. The web app and the CLI read the same object. |
| `src/definitions.ts` | `DEFINITIONS`, the capability definition factories keyed by capability id in registration order (`overview` and `platform-agent` come from the platform package, the rest from the capability packages), and `capabilityDefinitions(options)`, whose options are keyed by the same ids so tests can hand a definition fakes. |
| `src/candy-mountain.ts` | `candyMountainProduct(options, env)`: the product data joined with the definitions (`pluginTypes` is empty: every plugin type comes with its connection package) and the settings, and `CANDY_MOUNTAIN`. |
| `src/settings.ts` | `candyMountainSettings(env)`: the product's settings with the environment overrides Candy Mountain keeps ([Product settings](#product-settings)). |
| `src/*.test.ts` | Tests of the product: `candy-mountain.test.ts` (the product matches its configuration, a drift is refused naming every mismatch, each definition is keyed by its id and listed in the product, the modules load, and a boot registers the capabilities, modules, plugin types and families the product names, each after what it depends on), `capability-packages.test.ts` (every capability package the workspace installs is in both the daemon's `dependencies` and `DEFINITIONS`, its `package.json` names the capabilities its `dependsOn` does, it states its SDK major, and only a `plugin-` package brings a plugin type), `schema.test.ts` (every migration set the product boots matches its latest snapshot and references only tables it may) and `settings.test.ts`. Tests that run the capabilities together (a boot without each capability, workspace deletion across every capability's tables, the platform agent's Claude Code, Codex, issues and bots cases) live with the capabilities, in the development distribution of crab-shack/capabilities. |

The build (`tsdown`) bundles the product package, which is TypeScript source, into `dist/index.mjs` and leaves the platform and the capabilities as imports, so the built daemon starts under plain `node` and loads each from `node_modules`; a capability finds its migrations by its own package name. Below, a `src/` path is in the base's `packages/platform-daemon/src`.

## Adding or removing a capability

A capability is its package plus one entry in each list that names it. For a capability published from crab-shack/capabilities, `pnpm platform-add <id>` installs it with the capabilities it needs, does steps 1 to 3 and prints what remains; Candy Mountain keeps its product as code, not as a `product.yaml`, so step 4 is always by hand. The steps:

1. `apps/daemon/package.json`: `"@crab-shack/cap-<id>": "<exact version>"` in `dependencies`, and the same for each capability its `peerDependencies` name that is not there yet (the built daemon loads the package by name, and the lint and `capability-packages.test.ts` need it listed). A connection is `@crab-shack/plugin-<id>`.
2. `apps/daemon/src/definitions.ts`: the factory's import and its `'<id>': <id>Definition,` entry in `DEFINITIONS`, placed where it should register.
3. `apps/web/package.json`: the same dependency lines, at the same versions; the web app registers layers from the product's `layers` list and finds each in the installed package whose `package.json` names it as `webLayer`, so nothing else in `apps/web` changes.
4. `packages/candy-mountain/src/product.ts`: the id in `capabilities`, in `layers` when the package has a web layer, and in `pluginTypes` when it is a connection; `packages/candy-mountain/src/modules.ts`: a member `{ capabilityId: '<id>', defaultRung }` in the module that holds a feature.
5. `pnpm install`.

A capability particular to Candy Mountain is written here instead: `packages/cap-<id>` (or `packages/plugin-<id>` for a connection) under the `@candy-mountain` scope, to the conventions in the platform's `packages/platform-daemon/README.md` (copy the base's `packages/cap-template`, whose README walks through the copy step by step), with `"@candy-mountain/cap-<id>": "workspace:*"` as its dependency line in both apps and the rest of the list unchanged. There is none today.

Removing one is the reverse: the two dependency lines, the import and the entry, its ids from `product.ts` and its member from `modules.ts`, then `pnpm install`. A missed list names itself: the daemon refuses to boot while the product data and the definitions disagree (`assertProduct`); `capability-packages.test.ts` fails naming a package that is installed but not in `DEFINITIONS`; a package `DEFINITIONS` imports that the daemon's `package.json` does not list fails the lint (`cm-packages`) and, once `pnpm install` has dropped it, the tests' import of it; and `packages/candy-mountain/src/product.test.ts` fails while a module names an unlisted capability. A capability that others need goes with its dependents: the daemon refuses to boot a definition whose `dependsOn`, required plugin type or required workspace fact has gone, naming both. Variables a removed capability read (below) are ignored.

### Development-only capabilities

A product may include a capability only in development through `developmentProductConfig` and `ProductDevelopment` in `@crab-shack/platform-sdk`: the ids go in a development declaration the build's configuration never names, the package in `devDependencies`, its factory in a development definition list the build entry never imports, and the web app adds the development layers under `$development`. Candy Mountain has no such capability; `capability-packages.test.ts` refuses a capability package that is not in both `dependencies` and `DEFINITIONS`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `CM_DAEMON_HOST` | `127.0.0.1` | Bind address |
| `CM_DAEMON_PORT` | `4310` | Port |
| `CM_DATA_DIR` | `$XDG_DATA_HOME/candy-mountain`, else `~/.local/share/candy-mountain` | Data directory (`~` is expanded, relative paths resolve against the working directory) |
| `CM_SECRETS_KEY` | unset | Secrets master key: exactly 32 bytes, base64-encoded. Generate with `openssl rand -base64 32`. See [Secrets](#secrets) |
| `CM_AUTH_STRATEGY` | `development` | `development`, `password` or `trusted-header`. See [Auth](#auth) |
| `CM_AUTH_TRUSTED_HEADER` | unset | Header carrying the username; required with `trusted-header` |
| `CM_ADMIN_PASSWORD` | unset | Sets or resets the admin password at boot (any strategy). See [Password strategy](#password-strategy) |
| `CM_AUTH_SESSION_TTL` | `30d` | Password-strategy session lifetime: `<n>s`, `<n>m`, `<n>h` or `<n>d`, at most `400d` |
| `CM_AUTH_LOGIN_MAX_FAILURES` | `10` | Password strategy: failed logins allowed per username and per client IP within the window before `429` |
| `CM_AUTH_LOGIN_WINDOW` | `1m` | Password strategy: the failed-login window, same duration format as the session TTL |
| `CM_AUTH_COOKIE_SECURE` | `false` | `true` adds `Secure` to the session cookie; set it when the web app is served over https |
| `CM_WORKTREES_PER_PROJECT` | `4` | Worktrees: active worktree leases allowed per project; an acquire beyond it is refused. Overrides the bots setting `worktreesPerProject`; see [Product settings](#product-settings) |
| `CM_WORKTREE_IDLE_TIMEOUT` | `2h` | Worktrees: a lease unused this long is reclaimed if its worktree holds no uncommitted or unpushed work (`90s`, `15m`, `2h`, `1d`; at most `30d`). Overrides the bots setting `worktreeIdleTimeoutMs` |
| `CM_WORKTREE_RECLAIM_INTERVAL` | `10m` | Worktrees: how often the idle reclaim pass runs, in the same duration format. Overrides the bots setting `worktreeReclaimIntervalMs` |
| `CM_WEB_URL` | `http://127.0.0.1:4300` | Origin of the web app, used to build the absolute links in Slack notifications. See [Notifications](#notifications) |

The platform reads the address, data directory, secrets key, auth, admin password and `CM_WEB_URL` in `loadDaemonConfig`. `CM_WORKTREE*` are Candy Mountain's own: they override product settings (below). A capability reads its own variables when its definition starts, so an invalid value still fails the daemon at boot, and a variable of a capability the product does not list is ignored: `CM_SESSION_IDLE_TIMEOUT`, `CM_SESSION_MAX_LIVE` and `CM_DECISION_TIMEOUT` (`@crab-shack/cap-acp`), `CM_UPTIME_HISTORY_MAX` and `CM_UPTIME_HISTORY_MAX_AGE` (`@crab-shack/cap-uptime`). Their defaults and formats are in those packages' READMEs. Options a test hands a definition override its variables.

### Product settings

A capability can declare product-level settings; the platform checks the product's block for it at boot, before anything touches disk, and hands the values to its `start` as `context.settings`. A wrong type, a value out of range, an undeclared key or a block for a capability the product does not list stops the daemon naming the capability and the key, for example `Product 'Candy Mountain' settings do not match its capabilities: capability 'bots' setting 'worktreesPerProject' must be a whole number of at least 1, not 0.`

| Capability | Setting | Default | Environment override |
|---|---|---|---|
| `bots` | `worktreesPerProject` | `4` | `CM_WORKTREES_PER_PROJECT` |
| `bots` | `worktreeIdleTimeoutMs` | `7200000` (2h) | `CM_WORKTREE_IDLE_TIMEOUT` |
| `bots` | `worktreeReclaimIntervalMs` | `600000` (10m) | `CM_WORKTREE_RECLAIM_INTERVAL` |

- Declared by `@crab-shack/cap-bots` (`BOTS_SETTINGS`, exported from its root entry and described under "Settings" in its README; the durations are integers of milliseconds from 1 to 30 days).
- Candy Mountain's values are `CANDY_MOUNTAIN_SETTINGS` in `packages/candy-mountain/src/settings.ts`; change them there.
- The environment is read in `apps/daemon/src/settings.ts` (`candyMountainSettings(env)`), which the entry point calls with `process.env` through `candyMountainProduct({}, process.env)`. A set variable wins over the product's value, keeps its old format (a positive integer; `90s`, `15m`, `2h`, `1d` up to `30d`) and is checked against the declaration, so a bad one stops the boot with, for example, `Capability 'bots' setting 'worktreeIdleTimeoutMs': CM_WORKTREE_IDLE_TIMEOUT must be a duration such as 90s, 15m or 2h, at most 30d, got "2 hours".` An empty variable leaves the product's value. Tests boot `CANDY_MOUNTAIN` without the environment.
- `capabilityDefinitions({ bots: { worktrees } })` options still override the settings, for tests.

`~/.candy-mountain` is not used because Candy Mountain v2 owns it. Keep the data directory outside any repository.

## Where each capability is documented

Each installed package carries its own `README.md` (in crab-shack/capabilities under `packages/`, and in `node_modules` beside the code): its routes, background work, tables, settings, environment variables and what it expects of the connections it uses.

| Subject | Package |
|---|---|
| The workspace's checkout and its verification, the `repository` plugin type (GitHub and Bitbucket) and its branches action | `@crab-shack/plugin-repository` |
| Issues read and written through the checkout's `.beads` tracker, the event stream, assignees | `@crab-shack/cap-issues` |
| Bots, bot sessions, bot posture, Slack routing, turn progress, decisions and handoffs, worktrees and their reclaim | `@crab-shack/cap-bots` |
| The team roster | `@crab-shack/cap-team` |
| Uptime monitors, their sources, checks, state and incidents | `@crab-shack/cap-uptime` |
| Environments and live versions | `@crab-shack/cap-deployments` |
| Agent sessions over ACP, durable sessions, pending decisions | `@crab-shack/cap-acp` |
| The Claude Code and Codex chat agents | `@crab-shack/cap-chat-claude-code`, `@crab-shack/cap-chat-codex` |
| Slack connections, the `slack` plugin type, the `post_blocks` tool and the Slack notification channel | `@crab-shack/plugin-slack` |
| The `claude-code`, `codex`, `heroku` and `netlify` plugin types | `@crab-shack/plugin-claude-code`, `@crab-shack/plugin-codex`, `@crab-shack/plugin-heroku`, `@crab-shack/plugin-netlify` |
| The Claude Code ACP shim | `@crab-shack/claude-acp` |

The sections below describe the platform's subsystems as this daemon runs them.

## Data directory

Created on start (mode `0700`) if missing:

```
<data dir>/
  candy-mountain.db   SQLite database (WAL mode, so -wal/-shm files appear while running)
  secrets/            encrypted secret values, see Secrets
  worktrees/
  agent-homes/
  logs/
  run/                pid files
```

Moving to another machine is a copy of this directory with the daemon stopped.

## Database

One SQLite database through Drizzle (`better-sqlite3`), migrated as an ordered list of **migration sets** (`MigrationSet` in `src/db/index.ts`): the platform's own set (`PLATFORM_MIGRATION_SET`, id `platform`: schema `src/db/schema/`, migrations `src/db/migrations/`) and one per capability that declares a schema, each tracked under its own migrations table. How a capability declares, orders and generates its set, and which tables it may reference, is "Schema ownership" in the platform's `packages/platform-daemon/README.md`. `openDatabase(file, { sets })` applies them and returns `migrationSets` (`{ id, table, applied }` per set in order) plus `appliedMigrations`, the total. Pending migrations run automatically on every daemon start; a start with nothing pending applies nothing. The boot log names every set with its count. `src/db/fixtures/` holds two generated sets (`fixture-alpha`, and `fixture-beta` referencing its table) that the platform's tests boot.

The sets Candy Mountain boots:

| Set | Tables |
|---|---|
| `platform` | organisations, workspaces, workspace_modules, users, user_passwords, user_roles, roles, auth_sessions, role_grants, plugin_instances, platform_meta, activity_events, chat_threads, chat_thread_sessions, agent_sessions, agent_session_events |
| `repository` | repositories |
| `issues` | project_assignees |
| `bots` | bots, worktree_leases, slack_threads, slack_turns, slack_deliveries |
| `team` | team_members |
| `uptime` | uptime_monitors, uptime_checks, uptime_incidents |
| `deployments` | environments |

- Platform schema: the platform's `packages/platform-daemon/src/db/schema/`, one file per table group, each re-exported from its `index.ts`; migrations in `src/db/migrations/`, drizzle-kit config the platform's `packages/platform-daemon/drizzle.config.ts`.
- `apps/daemon/drizzle.config.ts` only points Drizzle Studio (`pnpm --filter @candy-mountain/daemon db:studio`) at the product's database.
- Migrations are generated by drizzle-kit and committed, never edited once applied, and reviewed for table rebuilds; the rules are "Generating migrations" in the platform's `packages/platform-daemon/README.md` and hold for the platform set too.

### Adding a table

A table is added where its set lives, by the steps under "Generating migrations" in the platform's `packages/platform-daemon/README.md`: in the base for the platform set, in crab-shack/capabilities for a shared capability's set, and here, in `packages/cap-<id>/src/schema/`, only for a capability of Candy Mountain's own. A new table of the platform or of a shared capability reaches Candy Mountain as a new version of the package; the next daemon start applies its migration, and the boot log says so.

`apps/daemon/src/schema.test.ts` checks every set the product boots against the latest snapshot in its own folder, which an installed package ships with its migrations, and fails when a set's schema has changes without a generated migration. `db:studio` opens Drizzle Studio on the configured database.

### Using the database

`startPlatform(dataDir, { product })` (`src/platform.ts`) is platform start. `product` is required and is the only thing that says what runs: the platform keeps no default capability, module or plugin type list of its own and imports no product capability. What it validates, the order it starts and closes definitions in and how their services are bound are "Service lifecycle" in the platform's `packages/platform-daemon/README.md`. It returns `{ product, paths, db, migrationSets, appliedMigrations, secrets, capabilities, modules, pluginTypes, families, activityEventTypes, workspaceFacts, runtime, agentMcp, notifications, close }`. Nothing on `Platform` is specific to a capability: a capability's services are read from the started list with `platform.runtime.service(KEY)`, the key exported by the definition that offers it. The product (`Product` in `src/product.ts`) joins the shared configuration (`ProductConfig` from `@crab-shack/platform-sdk`; Candy Mountain's is `CANDY_MOUNTAIN_PRODUCT` in `@candy-mountain/candy-mountain`: name, scope label and the capability, module, plugin type and layer ids) with what the daemon runs: this app's `src/index.ts` hands `runDaemon` the product `candyMountainProduct()` (`apps/daemon/src/candy-mountain.ts`) builds from `capabilityDefinitions()` (`apps/daemon/src/definitions.ts`), the product package's `MODULES` and no product-level plugin types. Before anything else `assertProduct` refuses boot with `ProductError` naming every id the configuration lists that nothing supplies, or that is supplied but not listed; the capability list names service-only definitions (`slack`) too.

`createApp(deps)` (`src/app.ts`) is the app factory. `deps.product` is required too; `capabilities`, `modules`, `pluginTypes`, `families` and `workspaceFacts` are built from it when not passed (`runDaemon` passes the platform's). It exposes `db`, `paths` and the registries to routes as `c.var`, mounts the platform's own routes and each started definition's workspace and platform routes, runs the definitions' workspace deletion hooks when a workspace is deleted (both described in the conventions), and serves chat threads when the runtime offers `THREAD_SESSIONS` (with the started definitions' `workspaceAgents` and `chatFamilies` when offered). `AppDeps` has no field for any one capability. `GET /info` answers `{ version, dataDir, authStrategy, productName, scopeLabel }` from the product, so the web app need not import the constants. Services take `db: Db` as a parameter rather than importing a global.

Session families (`threads/families.ts`) and the plugin type and module registries (`plugins/registry.ts`, `modules/registry.ts`) are platform and exported from the root entry. Migration folders are read from the package's own `src/` through `PACKAGE_ROOT` in `package-root.ts`, resolved by package name rather than from `import.meta.url` so the folder is found both from source and from a distribution's bundle, which inlines the package's code but never its migrations.

Tests in the platform package and in every capability package use the platform's test kit, `@crab-shack/platform-daemon/testing` (source the platform's `packages/platform-daemon/src/testing`, documented in the platform's `packages/platform-daemon/TESTING.md`), which knows no product; the platform's root entry exports none of it. Tests in this app use that kit with `CANDY_MOUNTAIN` as the product.

## Secrets

`src/secrets/` stores tokens and keys for plugins, bots and auth. Each value is encrypted with AES-256-GCM under `CM_SECRETS_KEY` (random 12-byte IV per write; owner and name bound in as associated data, so a file copied to another slot fails to decrypt) and written atomically to `secrets/<owner>/<name>.json` with mode `0600` inside `0700` directories. Owners and names are 1-128 of letters, digits and `. _ : @ -`, starting with a letter or digit.

Keep the key outside the data directory and back it up separately: moving machines means copying the data directory and setting the same key. Without it the values cannot be recovered.

If `CM_SECRETS_KEY` is unset the daemon still starts, logs a warning, and the store is locked: `set` and `get` throw `SecretsLockedError`, while `isSet`, `delete` and `deleteOwner` keep working. A malformed key (not base64, or not 32 bytes) stops the daemon at boot.

`startPlatform(dataDir, { product, secretsKey })` returns the store as `platform.secrets`:

- `set(owner, name, value)`, `isSet(owner, name)`, `delete(owner, name)`, `deleteOwner(owner)` (returns the number removed). Delete an owner's secrets when deleting the owner.
- `get(owner, name)` returns the plaintext or `undefined`; it throws `SecretDecryptError` when the key is wrong. Only daemon-side services may call it.
- `platform.secrets.writeOnly` is a frozen view without `get`. It is the only form route handlers may receive; never put the full store in `c.var` or return a value over HTTP.

Errors name the owner and secret but never carry the value or the underlying crypto error. Tests use `createSecretsStore(dir, MasterKey.generate())` from `src/secrets`, with `dir` inside `createTempDataDir()`.

## Mastra

Mastra runs as a library only (no server routes or Studio). `createMastra(paths, { agents? })` in `src/mastra.ts` points a `@mastra/libsql` store at `candy-mountain.db`, creates its `mastra_*` tables, registers the agents the optional factory returns (it receives the store, so agent memory shares the file) and returns `{ mastra, storage, close }`; the platform-agent definition (`src/platform-agent/definition.ts`) creates it once at start with the platform agent, waits for it on the first turn, and shuts it down in its close after cancelling the turns still streaming. Those tables, including the memory ones, are Mastra's own: never add them to the Drizzle schema or migrations. Nothing here needs an API key or the network until a turn runs.

## Workspaces and organisations

`src/workspaces/` owns both. Routes are mounted at `/workspaces` (`WORKSPACES_PATH`) and `/organisations` (the web proxy maps `/api/*` to them); wire types live in `@crab-shack/platform-sdk` (`workspaces.ts`: `Workspace`, `WorkspaceResponse` `{ workspace }`, `WorkspaceListResponse` `{ workspaces }`, `CreateWorkspaceRequest`, `UpdateWorkspaceRequest`; `slug.ts`, `api-error.ts`). The platform says workspace in its tables, columns, routes, wire types and identifiers; the word users see is the product's scope label (Candy Mountain's says project), so daemon messages a person reads take it from `c.var.scopeLabel` (`No project with slug ...` for Candy Mountain); the workspace functions take it as an optional last argument and say workspace without one. Migration `0022_workspaces` renamed `projects` to `workspaces`, `project_modules` to `workspace_modules` and the `project_id` column of `workspace_modules`, `activity_events`, `agent_sessions`, `chat_threads`, `plugin_instances` and `repositories` to `workspace_id` (with their indexes), and rebuilt `plugin_instances` to turn the scope value `project` into `workspace`; every row is kept (`src/workspaces/migration.test.ts`). Product tables (`bots`, `worktree_leases`, `project_assignees`, `team_members`, `environments`, the uptime and Slack tables) keep their `project_id` columns. A workspace is platform: identity, slug, name, colour, organisation and archived state, and nothing else, so creating one needs no path. Other daemon code resolves a project with `getWorkspaceBySlug(db, slug)` / `findWorkspaceBySlug`; its checkout belongs to the repository capability (below). Errors are `{ error: { code, message } }`: `invalid_request` 400, `not_found` 404, `slug_taken` 409, `organisation_not_found` 422.

## Auth

Every request passes one middleware (`src/auth/middleware.ts`) that asks the configured strategy for an actor. Routes read `c.var.actor` (`{ id, username, displayName, roles }`, type `Actor` from `@crab-shack/platform-sdk`) and never a header or cookie. No actor means `401 { error: { code: 'unauthenticated' } }`. Only `PUBLIC_PATHS` (`/health`, `/auth/strategy`) and a strategy's own `publicPaths` skip the check; `c.var.actor` is unset there.

Strategies, chosen with `CM_AUTH_STRATEGY` at boot (an invalid value stops the daemon):

- `development` (default): every request is the admin.
- `password`: a server-side session identified by a cookie, issued by logging in. See [Password strategy](#password-strategy).
- `trusted-header`: the value of `CM_AUTH_TRUSTED_HEADER` is matched exactly against `users.username`; missing, empty or unknown is a 401. Only safe when a proxy in front of the web app overwrites that header on every request and nothing else can reach the web app or daemon, since the web proxy forwards browser headers unchanged.

Users live in `users`, roles in `roles` (keyed by `slug`), membership in `user_roles`. `seedAuth` runs on every start and ensures the `admin` user holding the `admin` role exists. `GET /auth/me` returns `{ actor }`. `GET /auth/strategy` is public under every strategy and returns `{ strategy }`, so a login page can tell whether to show itself before anyone is signed in.

### Password strategy

- `POST /auth/login` with JSON `{ username, password }`: `200 { actor }` plus a `cm_session` cookie (`HttpOnly; SameSite=Lax; Path=/; Max-Age=<ttl>`, `Secure` with `CM_AUTH_COOKIE_SECURE=true`). A wrong username or password is `401 { error: { code: 'invalid_credentials' } }` and creates no session; a malformed body is `400 invalid_request`. Logging in replaces the session the request's cookie held.
- `POST /auth/logout`: deletes the session, clears the cookie, `204`. Public, so an expired cookie can still be cleared.
- Login is rate limited in memory (reset on restart): more than `CM_AUTH_LOGIN_MAX_FAILURES` failures within `CM_AUTH_LOGIN_WINDOW` for a username or for a client IP gets `429 { error: { code: 'rate_limited' } }` with `Retry-After` before the password is checked. A successful login clears that username's counter. The IP is the socket address; `X-Forwarded-For` is ignored, so behind a reverse proxy all clients share the proxy's IP.
- Both routes exist only under this strategy (`404` otherwise).
- Sessions live in `auth_sessions`, keyed by the SHA-256 of the cookie token, and expire `CM_AUTH_SESSION_TTL` after login (no sliding renewal). An expired session is a 401 and is deleted; logins purge other expired rows.
- Password hashes live in `user_passwords` (one row per user, cascading with `users`), never in `users` and never in a response. Format `scrypt$N$r$p$salt$hash` from `node:crypto` scrypt (N=2^17, r=8, p=1, OWASP's baseline), so there is no native hashing dependency; verification reads the parameters from the stored hash, so they can be raised later.
- Setting the admin password: start the daemon with `CM_ADMIN_PASSWORD` (8 to 1024 characters). A different value replaces the hash and signs the admin out everywhere; the same value is a no-op, so leaving it set does not log you out on restart. It can be removed after the first start since the hash persists. Inside the daemon, `setUserPassword(db, userId, password)` does the same for any user.
- With `CM_AUTH_STRATEGY=password` and no admin password stored, the daemon refuses to start.

### Adding a strategy

1. Add its name to `AUTH_STRATEGY_NAMES` in the platform's `packages/platform-sdk/src/auth.ts`.
2. Add a branch for it to `AuthConfig` and `resolveAuthConfig` in `src/auth/config.ts` with any settings it needs.
3. Implement `AuthStrategy` (`name`, `resolve(c)` returning an `Actor` or `null`, optional `publicPaths`, optional `routes()` mounted under `/auth` for endpoints such as login) using `findActorById` / `findActorByUsername`, and return it from `createAuthStrategy` in `src/auth/strategy.ts`.

`createApp` defaults to the development strategy, so tests only pass `auth` when they exercise another one.

## Capabilities

The manifest, the runtime definition, the define helpers and contract types (on `@crab-shack/platform-sdk/daemon`), open ids and what boot refuses are "The runtime definition" in the platform's `packages/platform-daemon/README.md`. The daemon's `src/capabilities/definition.ts`, `src/capabilities/manifest.ts` and `src/plugins/definition.ts` re-export the SDK's contract and keep the runtime pieces (`boundServices`, `dependencyServices`, the platform schema tables).

A feature capability's manifest is `src/manifest.ts` in its package, exporting `defineCapability({...})`; the package joins the product as in [Adding or removing a capability](#adding-or-removing-a-capability).

The registry is `platform.capabilities` and `c.var.capabilities` in routes: `list()`, `byId(id)` (or `undefined`), `get(id)` (throws), `has(id)`. Tests use `fixtureCapability(id)` and `cloneManifest()` from `src/capabilities/fixtures.ts` with `createCapabilityRegistry([...])` or `startTestPlatform(dir, { capabilities: [...] })`.

## Modules and grants

Modules are product data, declared in `packages/candy-mountain/src/modules.ts` (`MODULES`): `issues`, `agent-hub`, `operations`. Each lists member capabilities as `{ capabilityId, defaultRung }`; a capability may sit in several modules and an empty module is valid. `startPlatform` checks them against the capability registry before touching disk (member registered, default rung on its ladder, no duplicates) and refuses to boot with `ModuleDefinitionError`. The registry is `platform.modules` and `c.var.modules`: `list()`, `byId()`, `get()`, `has()`, `withCapability(id)`.

Grants live in `role_grants`, one row per role and target (`module` or `capability`), with a rung per capability (`src/grants/`, wire types in `grants.ts`). A module grant stores every member's rung; a member missing from a stored grant (added to the module later) gets its default rung. Rows cascade with the role.

`resolveActorRungs({ db, capabilities, modules }, actor)` (pass `c.var` in a route) returns the rung of every registered capability: the admin role gets the top of every ladder without reading grants; anyone else gets the highest rung across all grants of all their roles; anything ungranted, unknown or stale is `none`; any error resolves everything to `none`. `rungOf(rungs, id)` reads one capability, defaulting to `none`.

On every start `seedAdminGrants` gives the admin role a grant on each module it has none for, at each member's top rung; existing grants are never overwritten.

Admin-only REST under `/grants` (403 `forbidden` for anyone else):

- `GET /grants` -> `{ grants: RoleGrant[], roles: { role, name, rungs }[] }` with each role's resolved rungs.
- `PUT /grants` with `{ role, target: { kind, id }, rungs }` -> `{ grant }`, creating or replacing that role's grant on the target. A capability grant names exactly its own capability. Errors: `invalid_request` 400, `role_not_found`, `target_not_found`, `invalid_rung` 422.

Guard any other admin-only route with `app.use(requireAdmin())` from `src/auth`.

A manifest's optional `everyoneRung` is a rung every signed-in actor holds without any grant (the platform agent uses `chat`); the resolver applies it before grants, so grants can raise a role above it but never below, and the admin still resolves to the top rung. `assertCapability` requires it to be a ladder rung other than `none`.

## Workspace modules

Each project enables its own modules; a new project has none. Rows live in `workspace_modules` (unique per workspace and module, cascade with the project; `src/workspace-modules/`). `listEnabledModules(db, projectId, modules?)` returns the enabled ids in module registry order, leaving out modules the registry no longer has (by id when no registry is passed), and `setEnabledModules(db, projectId, moduleIds, modules?)` replaces the set and returns it.

Admin-only REST (403 `forbidden` for anyone else):

- `GET /workspaces/:slug/modules` -> `{ modules: ModuleId[] }`.
- `PUT /workspaces/:slug/modules` with `{ modules }` -> `{ modules }`, replacing the set. Errors: `invalid_request` 400, `not_found` 404, `module_not_found` 422 (id not in the module registry; nothing is changed).

## Registry

`GET /workspaces/:slug/registry` (any signed-in actor; 404 `not_found` for an unknown slug) answers for the current actor and one project with a `RegistryResponse` (`@crab-shack/platform-sdk` `registry.ts`): the sidebar `groups` (one per enabled module with something to show, one per standalone capability, then the fixed system group last), every `views` entry the actor's rung shows with its absolute web route (`workspaceViewRoute(prefix, slug, path)`: `/<prefix>/<slug>` for the home path `''`, else `/<prefix>/<slug>/<path>`, where `prefix` is the product's `scope.urlPrefix`, `p` for Candy Mountain), the `agents` the actor may chat with, each granted `capabilities` entry with its rung, readiness and reasons, and the `degraded` modules with reasons. Code is in `src/registry/`: `computeRegistry(input)` is pure over plain data, `loadRegistry(c.var, actor, project)` gathers that input, taking the prefix from `c.var.scopeUrlPrefix`. The system group's first entry is the workspace list, whose id and route come from the product's `scope.listPath` (`c.var.scopeListPath`; `projects`, so `/projects`, for Candy Mountain).

A capability is a candidate for a project when it belongs to an enabled module, or to no module at all (standalone). It is ready when every plugin type in `requiresPlugins` resolves to an instance for the project (`resolvePluginInstance`: its own, else a global one) whose required secrets are set and whose stored health is healthy (never tested counts as not ready), and every fact in the manifest's optional `requiresWorkspaceFacts` holds. Workspace facts are open ids declared by the capability that can answer them: a definition's `workspaceFacts` lists `{ id, compute(db, workspace), message(label) }` (`WorkspaceFactDeclaration` in `src/registry/facts.ts`; ids are camelCase, `FACT_ID_PATTERN`), `startPlatform` registers them before touching disk (`createWorkspaceFactRegistry`, refusing a malformed or duplicate id, and `assertRequiredWorkspaceFacts`, refusing a manifest that requires a fact no definition declares, naming both), and the registry loader and gates compute every declared fact through `c.var.workspaceFacts` (`WorkspaceFactRegistry`: `list`, `has`, `compute(db, workspace)`, `messages()`); `platform.workspaceFacts` holds the registry and `createApp` builds one from the definitions when not passed. `repository` declares `hasBeads`, `isGitRepo` and `hasRemote` from its stored verification; `bots` declares `hasBots` from a row lookup, so `team` (which requires it) cannot ship without `bots`. A manifest may also name `requiresPlatformFacts` (`llmGateway`: the gateway base URL, key and model id are all set in the platform settings; the platform's own list, `PLATFORM_FACT_IDS` in `src/registry/readiness.ts`), which is the same answer for every project and actor; its reason has `kind: 'platform-fact'`. A module is degraded when any member is not ready. The admin sees unready views in the sidebar with the group flagged `degraded` and reasons in `capabilities[].reasons` and `degraded`; other roles get only ready entries in `groups` and `agents`, unready views still listed in `views` with `ready: false`, and no reasons.

Gate routes and tools with `gateView` / `gateTool` / `gateChat(c.var, actor, project, capabilityId, ...)`: each returns `{ allowed: true, rung, scope? }` or `{ allowed: false, code, reason, status }` (`capability_unknown` 404, `not_enabled` 404, `not_granted` 403, then `not_ready` 409; reasons name plugins only for the admin). `requireCapability({ capability, view | tool | chat })` is the Hono middleware form for a `/workspaces/:slug/...` route, answering with the error body.

## Activity events

`activity_events` (`src/activity/`) is the per-project feed that the Overview and notifications read; rows cascade with the project. Only the daemon writes: call `appendActivityEvent(db, { workspaceId, type, title, link?, payload? })` (type must be registered, else `ActivityEventTypeError`: each capability definition declares the types it appends in `activityEventTypes` (`{ id, label, icon?, notifications? }`, `ActivityEventTypeDeclaration` in `src/activity/types.ts`), and `startPlatform` registers them from the definitions before touching disk, refusing boot on an invalid or duplicate type or notification kind; the threads definition declares `session.started` and `run.started`, bots `bot.handoff`, uptime `incident.opened` and `incident.closed`, deployments `deploy.attempted`. `GET /activity/types` (`ACTIVITY_TYPES_PATH`) -> `{ types: [{ id, label, icon }] }` is the registered list the web's filters read; `link` an in-app path, `payload` a JSON object capped at 4096 bytes, else `ActivityError` `payload_too_large`). There is no HTTP route that creates events.

`GET /workspaces/:slug/activity?type=&limit=&before=` -> `{ events, nextCursor }`, newest first. `limit` is 1 to 200 (default 50); pass `nextCursor` as `before` for the next older page (null when done). Errors: `invalid_request` 400 (bad type, limit or cursor), `not_found` 404.

## Plugin types

A plugin type is code in the connection package that brings it, a `plugin-<id>` package; why only a connection package brings plugin types, and how boot and the distribution's tests enforce it, is in the platform's `packages/platform-daemon/README.md`. Each of Candy Mountain's six types is described in its package's README ([Where each capability is documented](#where-each-capability-is-documented)). A type is exported via `definePluginType({...})` (from `@crab-shack/platform-sdk/daemon`) and listed in its definition's `pluginTypes`. A product may also pass types no capability brings in `Product.pluginTypes`; Candy Mountain passes none (`startPlatform` registers both and refuses a type both the product and a definition supply). A type declares `name`, `description`, `reach` lines (what the platform can do with it, shown before enabling), `scopes` (`project`, `global` or both), `singleInstance` (at most one instance per project, or per platform for global), `configFields` (`string`, `select` or `boolean`, checked with `validatePluginConfig`), `secretFields` (names only; values live in the secrets store), and `healthCheck({ config, secrets, signal, instance?, paths? })` returning `{ healthy: true }` or `{ healthy: false, reason }`. `config` and `secrets.get(name)` are typed from the declared fields; `instance` (`{ id, scope, projectId }`) and `paths` (`DataPaths`) are present when the check runs for a stored instance through `testPluginInstance` (pass `paths` in its deps; `c.var` and `Platform` have it) and absent from a bare `checkPluginHealth` call, so a type that keeps per-instance state on disk must handle their absence.

`startPlatform` builds the registry (`platform.pluginTypes`: `list()`, `ids()`, `byId()`, `get()`, `has()`) before touching disk and refuses to boot with `PluginTypeError` on a bad or duplicate type, or with `CapabilityManifestError` when a capability's `requiresPlugins` names a type that is not registered.

Health checks get secrets through `createPluginSecrets(platform.secrets, instanceId, type)`, which reads only that instance's declared secrets (owner `plugin:<instance id>`, see `pluginSecretOwner`); never hand it or the full store to routes. Run checks with `checkPluginHealth(type, { config, secrets })`: it never throws, times out after 15 s (aborting `signal`), and redacts any secret value the check read from the reason. Tests use `fixturePluginType(id)` and `clonePluginType()` from `src/plugins/fixtures.ts`.

## Plugin instances

An instance is one configured connection of a plugin type, owned by a workspace (`scope: 'workspace'`) or by the platform (`scope: 'global'`). Rows live in `plugin_instances` (cascade-deleted with their project); secret values live only in the secrets store under owner `plugin:<instance id>`. Code is in `src/plugins/instances/`, wire types in `@crab-shack/platform-sdk` (`plugin-instances.ts`).

Admin-only REST under `/plugins` (403 `forbidden` for anyone else); `GET /plugin-types` -> `{ types: PluginTypeInfo[] }` is open to any signed-in actor:

- `GET /plugins?workspace=<slug>` -> `{ instances }`: the workspace's instances, then the global ones. Without `workspace`: global instances only.
- `POST /plugins` with `{ type, scope, workspace?: <slug>, config?, secrets? }` -> 201 `{ instance }`.
- `GET /plugins/:id`, `PATCH /plugins/:id` with `{ config?, secrets? }` (config is merged over the stored one, `null` removes a field), `DELETE /plugins/:id` -> 204 (runs the type's `onDelete` hook, then deletes the row and its secrets).
- `POST /plugins/:id/test` runs the type's health check and stores the result -> `{ instance }` with `health: { healthy, detail | reason, checkedAt }`.
- `GET|POST /plugins/:id/<action>`: per-type actions (below).

Responses show secrets only as `{ <name>: 'set' | 'unset' }`. In `secrets`, a non-empty string sets a value, an omitted key or `''` leaves it untouched, and `null` clears it (not allowed for a required secret). Any real config or secret change clears the stored health. Errors (`{ error: { code, message } }`): `invalid_request` 400, `not_found`/`action_not_found` 404, `project_not_found`/`type_not_found`/`unsupported_scope`/`invalid_config`/`invalid_secrets` 422, `instance_exists` (a second instance of a single-instance type for the same project or the platform)/`secrets_locked`/`instance_changed` 409.

Deleting a project through `DELETE /workspaces/:slug` runs the definitions' `onWorkspaceDeleted` hooks, then calls `deleteWorkspacePluginInstances`, which runs each instance's `onDelete` hook, so the agent homes go too; the instances' secrets go after the deletion commits. Other daemon code finds "the project's instance of type X" with `resolvePluginInstance(platform, projectId, typeId)` (its own instance, else the global one) and reads its secrets with `createPluginSecrets(platform.secrets, instance.id, type)`.

`createApp` takes `pluginTypes`, `secrets` (the write-only view, also `c.var.secrets`) and `secretsReader` (the full store; only handed to the `/plugins` route factory, never `c.var`). Without them it uses the product's plugin types (its own and those its definitions bring) and a locked store.

### Instance actions

A type adds endpoints to its instances with `actions` on `definePluginType`:

```ts
actions: {
  'login-start': {
    method: 'POST',
    async run({ instance, config, secrets, request, signal, paths }) {
      return { started: true } // JSON with 200, or return a Response (e.g. an SSE stream)
    },
  },
},
```

It is served at `/plugins/:id/login-start` behind the same admin guard. `config`, `secrets.get()` and `secretsWriter` (`set(name, value)` / `clear(name)`, which go through `updatePluginInstance` so they validate like a PATCH and reset the stored health) are typed from the type's fields; throw `PluginActionError(status, code, message, headers?)` for an error body. `refreshHealth()` runs the type's health check and stores it exactly like `POST /test`, resolving to the stored health or `null` when the instance changed or was deleted meanwhile (nothing stored); it still works after the request has ended, e.g. from a login process's completion. `resetHealth()` clears the stored health. Names are lowercase letters, digits and dashes; `test` is reserved. The Repository type's `branches` action is the example: `GET /plugins/:id/branches?limit=N` -> `RepositoryBranchList`, mapping `RepositoryHostError` to `repository_<code>` (`no_token` 409, `rate_limited` 503 with `Retry-After`, the rest 502).

A type that keeps per-instance state outside the database (an agent home) cleans it up with `onDelete({ instance, paths, secrets })`. It runs before the row and secrets are deleted, for `DELETE /plugins/:id` and for a project delete; if it throws, the instance stays.

## Daemon-hosted MCP tools

The agent sees a narrow tool; the daemon keeps the credentials and the scope. `src/agent-mcp/host.ts` (`startAgentMcpHost({ db, servers })`, `platform.agentMcp`) serves each `AgentMcpServerDefinition` (`{ name, appliesTo(session), tools: [{ name, description, inputSchema, annotations?, call(args, { session, signal }) }] }`) as stateless Streamable HTTP on `127.0.0.1:<random port>` at `/mcp/<server>/<sessionId>`: POST only, one JSON response per request (no SSE), a random bearer token per server and session per daemon boot, requests with an `Origin` header or a foreign `Host` refused, and `appliesTo` asked again on every request. Nothing is stored: `SessionManagerDeps.mcpServers(session)` (wired to `agentMcp.serversFor`) runs at every launch and resume and passes `StartSessionOptions.mcpServers` (`LaunchMcpServer { name, url, bearerToken, tools }`, checked by `assertLaunchMcpServers`: loopback http URL, names, token, tools) to the family launcher. Claude Code gets `--strict-mcp-config --mcp-config <inline JSON>` appended after the posture flags (never in the stored posture, where `--mcp-config` stays refused) and the tool's allow rule `mcp__<server>__<tool>` in the stored `--allowedTools`; Codex gets `CODEX_CONFIG.mcp_servers.<name> = { url, http_headers, enabled_tools, default_tools_approval_mode: 'approve' }`. Tool names live with the capability that serves them (`SLACK_POST_BLOCKS_TOOL` in `@candy-mountain/plugin-slack`); the bot posture allowlist is `packages/cap-bots/src/posture/mcp-tools.ts` (`WRAPPED_MCP_TOOLS`); `resolveBotPosture({ mcpTools })` takes only those, and `assertPostureNotWidened` refuses any other `mcp__` allow rule. A new wrapped tool: add it to `WRAPPED_MCP_TOOLS`, write its server definition, return it in `mcpServers` from the owning capability definition's `start` (the host serves every definition's servers and names none itself) and pass it in `mcpTools` where the bot session is started.

The one tool today is `post_blocks`, which `@crab-shack/plugin-slack` offers to sessions a Slack thread holds; its README describes the tool, what it accepts and what it refuses.

## Platform settings

`GET`/`PUT /settings/platform` (admin only, mounted when `AppDeps.secrets` is passed) hold the LLM gateway and platform agent settings. Values live in the `platform_meta` table (`llm.gatewayBaseUrl`, `platformAgent.modelId`); the gateway key is a secret (`platform:llm-gateway` / `api-key`) and is only ever reported as `gatewayKeySet`. In a `PUT`, omitted fields are unchanged and `null` or blank clears. Saving a key without `CM_SECRETS_KEY` returns 409 `secrets_locked`. Daemon code that needs the plaintext calls `resolveLlmGatewayConfig(db, platform.secrets)` from `src/settings`; it is never exposed over HTTP. Everything is unset by default and the daemon boots normally.

## Notifications

`src/notifications/` sends a Slack message when something happens in a project. Rules are per project, one per registered kind. A kind is declared under the event type that raises it (`notifications: [{ id, label, matches? }]`, the first kind whose `matches(payload)` passes wins): `bot.finished` (from `bot.handoff`, declared by bots), `incident.opened`, `incident.closed` (uptime), `deploy.succeeded` and `deploy.failed` (deployments; both from `deploy.attempted`, told apart by `payload.outcome`, one of `DEPLOY_OUTCOMES`: `succeeded` | `failed`; any other outcome notifies nobody). A product without a capability offers none of its kinds, and a stored rule for a kind the product does not register is kept in the blob untouched. A rule is `{ enabled, destination: { channelId } | { memberId } | null, lastFailureAt, lastFailureReason, lastDeliveredAt }`; an enabled rule must have a destination. Rules live in `platform_meta` as one JSON blob per project (`notifications.<projectId>`), no table of their own; `deleteWorkspace` removes it and the delivered ring with `deleteNotificationState`, as `platform_meta` has no foreign key to cascade from.

`GET`/`PUT /workspaces/:slug/notifications` (admin only, `workspaceNotificationsPath(slug)`) -> `{ kinds: [{ id, label }], rules }`, with one rule per listed kind. `PUT { rules: { <kind>: { enabled?, destination? } } }` merges: kinds left out are unchanged, and a kind that is present has its last failure cleared. Errors: `invalid_request` 400 (unknown kind, bad id, enabled without destination, both ids), `forbidden` 403, `not_found` 404.

The dispatcher (`platform.notifications`, started by `startPlatform`) subscribes to `subscribeActivityEvents(db, listener)` in `src/activity/events.ts`, so it sees every `appendActivityEvent` on the platform database in-process; there is no polling and no catch-up after a restart. For each event with a matching enabled rule it builds one `NotificationDelivery` (workspace, kind, destination, title and `CM_WEB_URL` + the event's `link`, or the project page when the event has none) and offers it to the `NotificationChannel`s the capability definitions returned, in list order: a channel answers false when it has no identity for that workspace and throws for a failed delivery. The dispatcher knows nothing of Slack; the Slack channel (offered by the `slack` definition; `@crab-shack/plugin-slack`'s README says what it posts and as whom) declines when the workspace has no Slack identity to post with. When no channel accepts, or none is offered, the dispatcher records `lastFailureAt` / `lastFailureReason` (`No delivery channel: ...`) on the rule and carries on. A channel error is recorded the same way; a success stamps `lastDeliveredAt` and clears the failure. Each delivery has 10 s in total.

Exactly-once: delivered event ids are kept per project in `platform_meta` (`notifications.delivered.<workspaceId>`, the last 500 ids) and an id is claimed before anything is sent. The tradeoff is at-most-once: a crash between the claim and the post loses that message rather than repeating it, and an id older than the ring would be delivered again if it were ever re-emitted, which nothing does today.

Producers: a `bot.handoff` event should carry `link` to the thread (`/p/<slug>/agents/<threadId>`) so the message opens it; incident events should link to the monitor; `deploy.attempted` must set `payload.outcome` to `succeeded` or `failed`.

## Chat threads

Chat agents come from the `chat-claude-code` and `chat-codex` capabilities (Agent Hub module, default rung `chat`; ladder `none` -> `chat` with chat on; no views). Each contributes one agent: `claude-code` (family `claude-code`, avatar `i-lucide-sparkles`, requires the `claude-code` plugin) and `codex` (family `codex`, avatar `i-lucide-square-terminal`, requires `codex`). An agent manifest's optional `family` and `avatar` show up on `RegistryAgent`; the registry lists an agent only when its capability is ready and the actor's rung allows chat.

`src/threads/` keeps `chat_threads` (project cascade, `actor_id`, `agent_id`, `current_session_id` -> `agent_sessions` cascade, `title`, `model`, `effort`, `unread`, `working`, `last_read_at`, `last_activity_at`, timestamps) and `chat_thread_sessions` (every session a thread has wrapped, with its model and effort). A thread is per actor, project and agent and wraps one session at a time, created with `sessions.create` without a `cwd`, so the thread service reads no path: the attached driver (chat-claude-code's session manager, through its `workingDirectory` dependency over `REPOSITORY_PATHS`) names the workspace checkout, a family it launches refuses a workspace without one (422 `family_unavailable`), and a native family such as the platform agent gets a null `cwd`; changing the model or effort starts a new session on the same thread. `working` follows the current session's status (`queued`, `starting`, `prompting`) through a session subscription, including prompts sent on the session routes; a turn that ends sets `unread` until the thread is marked read. Prompting or cancelling through the thread marks it read for the sender. On boot `working` is recomputed from the (reset) session statuses.

Routes, all under `/workspaces/:slug/threads` and gated by the chat rung of the agent's capability (`requireCapability({ capability, chat: true })`); another actor's thread is a 404:

- `GET ?agent=<id>` -> `{ threads }` most recently active first; without `agent` it covers every agent the actor may chat with and is refused only when none is allowed
- `POST` `{ agentId, title?, model?, effort? }` -> 201 `{ thread, session, sessions }`
- `GET /:id` -> `{ thread, session, sessions }`; `PATCH /:id` `{ title?, model?, effort? }` -> same (a model or effort change mid-turn is `thread_busy` 409)
- `POST /:id/read` -> `{ thread }`; `POST /:id/prompt` `{ text }` -> 202 `{ thread, session }`; `POST /:id/cancel` -> `{ thread, session }`
- `GET /agents/:agentId/options` -> `{ options: { agentId, family, models, efforts } }`; empty lists mean no selector

Stream a thread with the session events route on its `currentSessionId`. Model and effort: Claude Code offers the CLI aliases `opus`, `sonnet`, `haiku` (a full `claude-*` id is accepted too), passed as `--model`, and effort `low`/`medium`/`high`, passed as `--settings {"effortLevel":...}`. Codex offers what its adapter reported: `AcpSession.configOptions` holds the `configOptions` of `session/new`/`session/load` (and later `config_option_update`s), the session manager keeps them per project and family in memory, one set per model the agent ran with (`SessionManager.configOptions`), and the options route returns the latest `model` list plus every `reasoning_effort` seen. Before a Codex session has started in this project since boot both lists are empty, so the selectors stay hidden. A choice is checked against those lists (an effort a known model does not list is refused; a value the thread already has stays accepted after a restart empties them) and launches a new session with posture `codex: { model, reasoningEffort }`, which the launcher passes as `CODEX_CONFIG` `model`/`model_reasoning_effort`; nothing calls `session/set_config_option`. Errors add `unsupported_agent` 422 and `thread_busy` 409 to the session codes and the gate's `not_enabled`/`not_granted`/`not_ready`.
A family may run in-process instead of through the harness: `ThreadService.prompt(thread, text, actor)` looks the session's family up in `ThreadServiceOptions.native` (the `chatFamilies` of every started definition, each checked at boot against the registered session families; a `NativeFamilyRunner` per family) and, when one is registered, calls `sessions.run(sessionId, text, runner)`, which logs the prompt, sets the status to `prompting`, lets the runner append rows through `emit`, then appends `turn_end` (`end_turn`, `cancelled` after a cancel, `error` when the runner threw, with an `error` row first) and returns the status to `idle`. Cancel aborts the runner's `signal`. Everything else (working and unread, SSE, the chat panel) is unchanged because the rows and status changes are the same ones a harness session produces. A family without a runner that no harness launches (`platform` on the plain session routes) is `family_unavailable` 422.

Bots appear as chat agents too; `@crab-shack/cap-bots`'s README describes which bots are listed and how their threads differ.

## Platform agent

The `platform-agent` capability (`src/platform-agent/manifest.ts`) is standalone (in no module, so a candidate for every project), has no views, requires the `llmGateway` platform fact, grants `chat` to everyone through `everyoneRung`, and contributes the registry agent `platform` (family `platform`, avatar `i-lucide-mountain`) with three tools on the `chat` rung: `open_view`, `start_chat`, `describe_platform`. Until the gateway base URL, key and model id are all set on the Settings page the capability is not ready, so the agent is absent from `registry.agents` (the rail hides it), the admin sees the `platform-fact` reason, and creating or prompting one of its threads is refused `not_ready` 409.

`src/platform-agent/` holds the agent. `createPlatformAgent({ storage })` builds one Mastra `Agent` registered in `createMastra` under the id `platform`; its instructions, model and tools are dynamic arguments resolved per turn from the Mastra request context (`PlatformTurnContext` under `PLATFORM_TURN_KEY`): the actor, the project, the actor's `RegistryResponse` for that project (which is what the instructions and `describe_platform` are built from), a memoised `access(capabilityId)` -> `CapabilityAccess`, and the gateway settings. The model is an OpenAI-compatible config `{ providerId: 'llm-gateway', modelId, url: baseUrl, apiKey, api: 'chat' }`, so the gateway must speak `POST <baseUrl>/chat/completions`. Memory is `@mastra/memory` on the same LibSQL store (last 30 messages, no title generation, no semantic recall): the memory thread id is the chat thread id and the resource is the actor id, so a thread continues across turns and an actor's threads stay theirs.

`createPlatformAgentRunner(deps)` (`RegistryDeps` plus `secretsReader: SecretsStore` and `mastra`) is the `NativeFamilyRunner` for the `platform` family. Each turn it reads `resolveLlmGatewayConfig` (an `error` row with phase `start` if anything is missing), loads the registry, streams `agent.stream(text, { requestContext, memory, abortSignal, maxSteps: 6 })` and writes the log: streamed text as `text` rows (sliced no more often than every 150 ms), each tool call as `tool_call` (ACP-shaped: `toolCallId`, `title`, `kind: 'other'`, `status: 'in_progress'`, `rawInput`) and `tool_result` (`status`, `rawOutput`, a one-line text `content`), and, when a tool answered with an action, a `client_action` row `{ toolCallId, action }`. The transcript renders tool rows as it does for any agent and ignores `client_action` until the chat layer applies it.

Tools return values, never throw: `PlatformToolRefusal` `{ refused: true, code, reason }` (a gate code, `not_found` or `invalid_request`) which the agent relays in words, or an action. Every tool first checks the actor's own rung on `platform-agent` (`checkTool`), then the target: `open_view({ viewId })` finds the manifest that owns the view and runs `checkView` on the actor's access to that capability, answering `{ kind: 'navigate', to, projectSlug, viewId, capabilityId }` (`to` is the registry's web route); `start_chat({ agentId })` finds the agent's capability and runs `checkChat`, answering `{ kind: 'open_thread', agentId, threadId? }` (the browser creates the thread; chatting with the platform agent itself is `invalid_request`); `describe_platform()` answers the actor's registry as `PlatformDescription`. Shared types are in `@crab-shack/platform-sdk` `platform-agent.ts` (`PlatformClientAction`, `PlatformToolRefusal`, `PlatformActionResult`, `PlatformDescription`, `PLATFORM_AGENT_ID`, `PLATFORM_AGENT_TOOL_IDS`).

Tests (`src/platform-agent/platform-agent.test.ts`) use `startStubGateway(scriptedReply)` from `test-support.ts`, a tiny OpenAI-compatible server that picks a tool from the prompt's wording (`open <viewId>`, `chat with <agentId>`, `describe ...`) and answers from the tool result; `PUT /settings/platform` points the base URL at it. The same module serves a local live check.
