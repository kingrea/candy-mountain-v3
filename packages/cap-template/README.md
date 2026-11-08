# @candy-mountain/cap-template

The template capability: a small, complete capability to copy when you start a new one. This README is the capability author's guide. It explains the contract through the template's own files, gives the rules with their reasons, shows what the tests prove, and walks through copying the template into a new package, adding it to both apps, and removing it.

The template keeps a list of short notes per workspace. That is deliberately dull, so the shape stays visible: one view, one operation tool, one route module, one table and migration, one workspace fact, one activity event type, one long-running service, one gated page, one overview card, and tests on both sides.

The two conventions documents hold the detail, and this guide links to them rather than repeating them:

- [`packages/platform-daemon/README.md`](../platform-daemon/README.md): the daemon half (the runtime definition, the service lifecycle, schema ownership, the dependency declaration, the `cm-packages` lint).
- [`packages/platform-web/README.md`](../platform-web/README.md): the web half (layer packages, the prefix, pages and the gate, contribution points, the `cm-layers` lint).

Candy Mountain includes the template in development only. `pnpm dev` runs it in both apps and no build carries it ([Development-only capabilities](../../apps/daemon/README.md#development-only-capabilities) in `apps/daemon/README.md`). It sits in a module of its own, `template` (`TEMPLATE_MODULE` in `packages/candy-mountain/src/development.ts`), so its sidebar entry appears only after an admin enables that module on a project's Modules page.

## What a capability is

A capability is one package, `packages/cap-<id>`, with two halves:

- `src/` is the daemon half, reached through the package's root entry (`src/index.ts`). It hands the platform a **runtime definition**: a manifest (views, tools, a rung ladder), a schema set with migrations, declared facts and event types, and a `start` that returns routes and services and a `close`.
- `nuxt.config.ts`, `app/` and `test/` at the package root are the web half, a Nuxt layer the web app extends: pages behind the gate, prefixed components and composables, and contributions to the shell such as an overview card.

The platform discovers nothing. A distribution lists each capability by name, and the daemon refuses to boot when its lists disagree.

## The files

### Daemon half (`src/`)

| File | What it is for | Contribution point |
| --- | --- | --- |
| `index.ts` | The root entry. It re-exports everything a distribution or a dependent capability may use: `templateDefinition`, `TEMPLATE_TICKER`, the ids and the wire types. Nothing outside the package imports any other file. | Package surface |
| `manifest.ts` | `templateCapability = defineCapability({...})`: id `template`, label `Template`, one view (`template`, at path `template`, icon `i-lucide-layout-template`), one tool (`template.manage`, kind `operation`) and the ladder `none` / `read` (sees the view) / `manage` (also holds the tool). | Catalog, modules, grants, sidebar entry, gate |
| `wire.ts` | Node-free constants and types shared by both halves: `TEMPLATE_MANAGE_TOOL`, `TEMPLATE_NOTE_MAX_LENGTH`, `workspaceTemplateNotesPath(slug)`, `TemplateNote` and the request and response shapes. The layer imports it by relative path. | Wire contract |
| `schema/template-notes.ts`, `schema/index.ts` | The `template_notes` table, whose `workspace_id` references `workspaces.id` with `onDelete: 'cascade'`. `index.ts` re-exports each table file. | Schema set |
| `migrations/` | drizzle-kit output (`0000_init.sql`, `meta/`), applied at boot under the migrations table `__drizzle_migrations_template`. | Schema set |
| `package-root.ts` | `PACKAGE_ROOT` and `srcPath(...)`, resolved from the package name, so the migrations folder is found from source and from a distribution's bundle alike. | Schema set |
| `notes.ts` | `listNotes`, `hasNotes` and `createNote`. `createNote` inserts the row and appends a `template.note.created` event through `appendActivityEvent`. | Activity |
| `routes.ts` | `templateRoutes()`: `GET /:slug/template/notes` behind `requireCapability({ view: 'template' })` and `POST` behind `requireCapability({ tool: 'template.manage' })`, mounted under `/workspaces`. | Workspace routes |
| `ticker.ts` | `startTicker(intervalMs)`: a harmless timer that stands in for a capability's long-running part. | Service |
| `definition.ts` | `templateDefinition({ tickIntervalMs })` returns `defineCapabilityDefinition({...})`. It declares the manifest, the schema set, `provides: [TEMPLATE_TICKER]`, the event type (with a notification kind of the same id) and the fact `hasTemplateNotes`. Its `start` binds the ticker, returns the routes, and stops the ticker in `close`. | Runtime definition, service key, fact, event type |
| `definition.test.ts` | Daemon tests on the platform's test kit (see [Tests](#tests)). | |

### Web half (`app/`, `test/`)

| File | What it is for | Contribution point |
| --- | --- | --- |
| `app/pages/p/[project]/template/index.vue` | The view's page at `/p/:project/template`, wrapped in `CapabilityViewGate capability="template" view="template"`. It reads the slot's `capability.tools` to decide whether to offer the form. It fetches nothing itself. | Gated page |
| `app/components/Notes.vue` | `TemplateNotes`: the list and the create form. It fetches inside the gate's slot and posts through `$api`. | Prefixed component |
| `app/components/Card.vue` | `TemplateCard`: the note count, shown only when there are notes. It asks for the notes only when `resolveViewAccess(...)` says the actor can see the view. | Overview card |
| `app/composables/useTemplateNotes.ts` | `useTemplateNotes(enabled?)`: one keyed `useAsyncData` request that both components share. | Prefixed composable |
| `app/plugins/template.ts` | `registerProjectHomeCard('aside', { id: 'template', component })`, which puts the card on the project home after Plugins. | Shell contribution |
| `test/unit/template-page.test.ts` | Page and card tests on the web test kit (see [Tests](#tests)). | |

### Package configuration

| File | What it holds |
| --- | --- |
| `package.json` | `name` `@candy-mountain/cap-template`; `"webLayer": "template"` (the layer id); one export, `"."`; the scripts `typecheck`, `lint`, `test`, `db:generate` and `db:check`. `dependencies` list the platform packages and every library the code imports. `devDependencies` hold `@candy-mountain/platform-config` and `@candy-mountain/platform-web` for the config files and tests, plus `drizzle-kit` and `@types/better-sqlite3`. |
| `nuxt.config.ts` | `components: [{ path: './components', prefix: 'Template' }]`, and `test/**/*` added to the web app's typecheck. |
| `vitest.config.ts` | `definePackageTestConfig('cap-template', { include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'] })` merged with `layerTestConfig(import.meta.url)`. |
| `tsconfig.json` | Extends the platform-config base and covers `src`, `drizzle.config.ts` and `vitest.config.ts`. The web app's `nuxt typecheck` covers `app/` and `test/`. |
| `eslint.config.js` | `layerPackageConfig(import.meta.url, ...base)`: `cm-packages` for `src/`, `cm-layers` and Nuxt's rules for the layer. |
| `drizzle.config.ts` | Schema `./src/schema/index.ts`, output `./src/migrations`. |

## The rules

Most of these rules are enforced by lint, by the daemon at boot, or by a distribution test. Each conventions document says which check refuses what.

**One id everywhere.** The capability id is the manifest `id`, the `<id>` in the package name and directory (`packages/cap-<id>`, `@candy-mountain/cap-<id>`), the `webLayer`, the schema set id and the module member's `capabilityId`. Use lowercase kebab-case. The layer prefix (`Template`), the page directory (`app/pages/p/[project]/<id>/`) and every view path (`<id>` or `<id>/...`) derive from it. *Why:* the platform, the lint and the distribution tests match these by string, and a capability added from another repository can only be found that way. ([Ids](../platform-daemon/README.md#ids), [The prefix](../platform-web/README.md#the-prefix))

**The definition is a factory.** `templateDefinition(options)` is a function, not a value, so a test or distribution can pass options (the template's tests pass a 5 ms tick). Variables the capability owns are read inside `start`, and the options override them. ([The runtime definition](../platform-daemon/README.md#the-runtime-definition))

**The manifest is data, the runtime is code.** The catalog, grants, modules, readiness and the sidebar are all computed from the manifest before anything starts, so the manifest carries no behaviour. `start` is synchronous. Anything it opens (timers, sockets, processes) is stopped in `close`, or it keeps the daemon alive after shutdown. ([The manifest](../platform-daemon/README.md#the-manifest), [Service lifecycle](../platform-daemon/README.md#service-lifecycle))

**Gate every workspace route.** Mounting under `/workspaces` only gives the handler a slug. It does not check anything. Each handler sits behind `requireCapability` with the view (to read) or the tool (to act) that the ladder grants. *Why:* the gate is where a rung, an enabled module and readiness are checked together. ([Routes](../platform-daemon/README.md#routes))

**Own your tables, write platform rows through the platform.** A capability has one migration set, in its own folder, and references only platform tables, its own tables and those of declared dependencies. A foreign key to `workspaces.id` with `onDelete: 'cascade'` means workspace deletion needs no hook, which is why the template has no `onWorkspaceDeleted`. Activity goes through `appendActivityEvent`, which refuses an undeclared event type and an oversized payload. That check is why the type is declared on the definition. Generated migrations are committed and never edited once applied. ([Schema ownership](../platform-daemon/README.md#schema-ownership), [Generating migrations](../platform-daemon/README.md#generating-migrations))

**Facts are cheap booleans.** `compute` runs on every registry read and gate check, so it is a row lookup and never a network call. A manifest can require a fact (`requiresWorkspaceFacts`) to gate readiness on it. The template declares `hasTemplateNotes` without requiring it. ([The other declarations](../platform-daemon/README.md#the-other-declarations))

**Cross package lines only through declared entries.** The capability imports `@candy-mountain/platform-daemon` (root entry) and `@candy-mountain/platform-sdk` (root and `/daemon`), and the platform-config and platform-web presets only from config files. It imports another capability only through that package's root entry, and only when its definition's `dependsOn` and its `package.json` `dependencies` both name that capability. It never imports a distribution (`apps/*`). *Why:* each of these is a declared contract that can be versioned, and `dependsOn` alone decides start order, service resolution and table order. The template depends on no other capability. ([Dependency declaration](../platform-daemon/README.md#dependency-declaration), [Refused at lint](../platform-daemon/README.md#refused-at-lint))

**The layer stays in its lane.** Its pages live only under `app/pages/p/[project]/<id>/`. Every auto-imported name carries the prefix. It never imports another layer, never imports `@candy-mountain/platform-web` by name (tests may import its `/test` entries), and never imports the package's root entry, which carries daemon code: it imports `src/wire.ts` relatively instead. *Why:* Nuxt merges every layer's auto-imports and pages into one namespace, so an unprefixed name or a page outside the layer's directory collides with someone else's. ([Dependency directions](../platform-web/README.md#dependency-directions), [Boundary lint](../platform-web/README.md#boundary-lint))

**Fetch inside the gate.** A page's `<script setup>` runs even while the gate locks it, so the page fetches nothing and the components inside the slot fetch instead. The overview card is outside every gate (the project home is open to everyone), so it checks `resolveViewAccess` before asking. *Why:* otherwise those requests hit the daemon's gate and fail. ([Views, the sidebar and the gate](../platform-web/README.md#views-the-sidebar-and-the-gate), [Project home cards](../platform-web/README.md#project-home-cards))

**Contribute through registration.** The shell never names a capability, so the layer adds itself from its own Nuxt plugin (`registerProjectHomeCard`, and the other `register*` functions the web conventions list). Removing the layer removes its contributions.

## Tests

Both suites run from the package root against the platform packages alone, with no app present. A capability's tests import test support only from the two test entries.

**Daemon: `@candy-mountain/platform-daemon/testing`** ([`TESTING.md`](../platform-daemon/TESTING.md)). `src/definition.test.ts` uses `testKit({ capabilities: [templateDefinition(...)] })`, which starts a platform over the template alone in a temporary data directory. It proves:

- the template boots with its migration set (`['platform', 'template']`), its fact and its event type registered;
- an actor with no grant gets `403 not_granted` on the list, and an actor at `read` gets the list (`kit.actor({ rungs: { template: 'read' } })`);
- creating a note needs `manage`, rejects blank text with `invalid_request`, appends the event (with its link to the view) to the workspace's activity feed, and turns the fact on;
- the ticker runs once started, and `kit.close()` stops it.

**Web: `@candy-mountain/platform-web/test`** ([Testing a layer's pages](../platform-web/README.md#testing-a-layers-pages)). `test/unit/template-page.test.ts` starts with `// @vitest-environment happy-dom`. It renders the page with `renderLayerPage(TemplatePage, { registry: layerRegistry({...}), api })` and the card through `layerComponents().OverviewCards`. `layerRegistry` defaults the capability, view and path to the layer under test. The tests prove:

- at `manage` the page lists the notes and offers the form, posts a note and shows it after the refresh;
- at `read` the form is hidden;
- when the view is denied, the gate reports `not-granted` and no notes request is made;
- the card shows the count, renders nothing with no notes, and neither renders nor asks when the actor cannot see the view.

## Commands

From the package root (`packages/cap-template`):

| Command | What it does |
| --- | --- |
| `pnpm test` | `vitest run`: `src/**/*.test.ts` in node, `test/unit/**/*.test.ts` with the web kit. |
| `pnpm typecheck` | `tsc --noEmit` over `src/` and the config files. |
| `pnpm lint` | `eslint .`: the package-boundary rules on `src/`, the layer rules on `app/` and `test/`. |
| `pnpm db:generate --name <short_name>` | Generates a migration from `src/schema/` into `src/migrations/`. |
| `pnpm db:check` | Validates the migration folder. |

From the repo root:

| Command | What it does |
| --- | --- |
| `pnpm --filter @candy-mountain/cap-template test` | The package's tests alone (`lint`, `typecheck`, `db:generate` work the same way). `pnpm turbo run test --filter=@candy-mountain/cap-template` runs the same thing through the Turborepo cache. |
| `pnpm --filter @candy-mountain/web typecheck` | `nuxt typecheck` with `NODE_ENV=development`, which typechecks the layer's `app/` and `test/` once the web app lists the package. |
| `pnpm dev` | Both apps' dev servers. The daemon runs `apps/daemon/src/dev.ts` (the development product) and the web app runs `nuxt dev`, so development-only capabilities are included. |
| `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` | The whole pipeline. |

## Starting a capability from the template

The steps below make a capability with the id `my-feature`. Substitute your own id in each of its forms:

| Form | Template | Example | Where it appears |
| --- | --- | --- | --- |
| kebab-case | `template` | `my-feature` | ids, paths, the layer id, the package name, event and tool ids |
| camelCase | `template` + capital | `myFeature` | `templateDefinition`, `templateRoutes`, `templateNotes` |
| snake_case | `template_` | `my_feature_` | the table and index names |
| PascalCase | `Template` | `MyFeature` | the component prefix, types, `useTemplateNotes`, `hasTemplateNotes` |
| UPPER_SNAKE | `TEMPLATE` | `MY_FEATURE` | constants and the service key |

### 1. Copy and rename

From the repo root:

```sh
cp -R packages/cap-template packages/cap-my-feature
cd packages/cap-my-feature
rm -rf node_modules .turbo src/migrations README.md
find . -type f \( -name '*.ts' -o -name '*.vue' -o -name '*.json' \) -exec perl -pi -e '
  s/TEMPLATE/MY_FEATURE/g;
  s/Template/MyFeature/g;
  s/template_/my_feature_/g;
  s/template(?=[A-Z])/myFeature/g;
  s/\{ template: /{ \x27my-feature\x27: /g;
  s/(?<!<)(?<!<\/)(?<!layout-)template/my-feature/g;
' {} +
mv src/schema/template-notes.ts src/schema/my-feature-notes.ts
mv app/plugins/template.ts app/plugins/my-feature.ts
mv app/composables/useTemplateNotes.ts app/composables/useMyFeatureNotes.ts
mv 'app/pages/p/[project]/template' 'app/pages/p/[project]/my-feature'
mv test/unit/template-page.test.ts test/unit/my-feature-page.test.ts
```

The substitutions run in order. The fifth quotes the id where `src/definition.test.ts` uses it as an object key (`rungs: { template: 'read' }`), because a hyphenated key must be quoted. The last one skips Vue's `<template>` tags and the Lucide icon name. `src/migrations` is deleted because it is regenerated in step 2, and the README because it describes the template. Write your own README.

Afterwards, `grep -rni template .` should list only `<template>` tags and the icon. Then make the human-facing text yours:

- `src/manifest.ts`: `label` and the view's `label` (now `'MyFeature'`), `description`, the view's `icon`, the ladder descriptions.
- `app/pages/p/[project]/my-feature/index.vue`: the navbar `title`. `app/components/Card.vue`: the card heading.
- `src/definition.ts`: the event type's labels and icon, and the fact's message.

### 2. Install, regenerate the migration, test it alone

Back at the repo root (`cd ../..`):

```sh
pnpm install
pnpm --filter @candy-mountain/cap-my-feature db:generate --name init
pnpm --filter @candy-mountain/cap-my-feature test
pnpm --filter @candy-mountain/cap-my-feature lint
pnpm --filter @candy-mountain/cap-my-feature typecheck
```

`db:generate` writes a fresh `src/migrations/0000_init.sql`, its snapshot and its journal, creating `my_feature_notes`. The set is applied under `__drizzle_migrations_my_feature`, which the platform derives from the id, so nothing else names it. The tests, lint and typecheck pass before either app lists the package. That is the "tests on their own" check.

The repo-wide `pnpm test` fails at this point, and that is intended: `apps/daemon/src/capability-packages.test.ts` reports `@candy-mountain/cap-my-feature: in neither definition list, in neither dependency section of apps/daemon/package.json`. Every `cap-*` package must be listed by the daemon, so step 4 is not optional.

### 3. Replace the notes with your feature

Keep the shape and swap the content: your tables in `src/schema/` (then `db:generate` again), your queries in place of `notes.ts`, your routes, your event types and facts, your service in place of the ticker (or drop `provides`, `services` and `close` if you have none), your pages and components. Change the tests alongside. The [daemon conventions](../platform-daemon/README.md) cover what the template does not use: `dependsOn` and services from other capabilities, plugin types (`requiresPlugins`, connection packages), platform routes, MCP servers, chat families, workspace deletion hooks. The [web conventions](../platform-web/README.md) cover the other contribution points (plugin panels and icons, project form fields and row items, chat pieces).

### 4. Add it to both apps

Choose whether the capability ships in Candy Mountain's builds or runs only under `pnpm dev`, as the template does. Each list below is checked by a test or by the daemon at boot, so a missed entry names itself.

**Shipped** (the full procedure is [Adding or removing a capability](../../apps/daemon/README.md#adding-or-removing-a-capability)):

1. `apps/daemon/package.json` and `apps/web/package.json`: `"@candy-mountain/cap-my-feature": "workspace:*"` in `dependencies`.
2. `apps/daemon/src/definitions.ts`: `import { myFeatureDefinition } from '@candy-mountain/cap-my-feature'` and `'my-feature': myFeatureDefinition,` in `DEFINITIONS`.
3. `packages/candy-mountain/src/product.ts`: `'my-feature'` in `capabilities` and in `layers`.
4. `packages/candy-mountain/src/modules.ts`: either add `{ capabilityId: 'my-feature', defaultRung: 'manage' }` to an existing module's `capabilities`, or add a new `ModuleDefinition` to `MODULES` and put its id at the same position in `modules` in `product.ts` (`product.test.ts` compares the two lists in order).

**Development only** (the full procedure is [Development-only capabilities](../../apps/daemon/README.md#development-only-capabilities)):

1. `apps/daemon/package.json` and `apps/web/package.json`: the same line in `devDependencies`.
2. `apps/daemon/src/development.ts`: the import and `'my-feature': myFeatureDefinition,` in `DEVELOPMENT_DEFINITIONS`.
3. `packages/candy-mountain/src/development.ts`: `'my-feature'` in `CANDY_MOUNTAIN_DEVELOPMENT.capabilities` (in the same order as `DEVELOPMENT_DEFINITIONS`) and in `layers`, and a new `ModuleDefinition` holding `{ capabilityId: 'my-feature', defaultRung: 'manage' }` in `DEVELOPMENT_MODULES`, with its id in `CANDY_MOUNTAIN_DEVELOPMENT.modules`. Leave `TEMPLATE_MODULE` alone: `apps/daemon/src/candy-mountain.test.ts` expects it to hold only the template.

Then, either way, `pnpm install` (it reruns `nuxt prepare` for the web app) and `pnpm lint`, `pnpm typecheck` and `pnpm test` from the root.

### 5. See it running

1. Run `pnpm dev`, restarting it if it was already running. The daemon's boot log names every migration set with its count, `my-feature` included. The web app is at `http://127.0.0.1:4300`. Under the default `CM_AUTH_STRATEGY=development` every request is the admin.
2. Create or open a project. Before its module is enabled, `/p/<slug>/my-feature` shows the gate's "not enabled" state. Enable the module on the project's Modules page (`/p/<slug>/setup/modules`). The view now appears in the sidebar under the module's label, and the page renders behind the gate.
3. Check the table: `sqlite3 ~/.local/share/candy-mountain/candy-mountain.db '.schema my_feature_notes'` (the database lives in `$CM_DATA_DIR` when that is set), or browse it with `pnpm --filter @candy-mountain/daemon db:studio`.
4. Add a note on the page. The project home (`/p/<slug>`) then shows "Note added: ..." in its activity feed and the card ("1 note") in its narrow column, after Plugins. The event's notification kind is offered on the project's Notifications page (`/p/<slug>/setup/notifications`).

## Removing a capability

Reverse step 4: remove the dependency lines from both apps' `package.json`, the import and the entry from `definitions.ts` (or `development.ts`), the ids from the product package, and the module member or module. Then delete `packages/cap-<id>`, run `pnpm install`, and run `pnpm lint`, `pnpm typecheck` and `pnpm test`. A capability that others depend on has to go with its dependents: the daemon refuses to boot a definition whose `dependsOn`, required plugin type or required fact is missing. The removed capability's tables and its `__drizzle_migrations_<id>` table stay in an existing database. Nothing reads them, so drop them by hand if you want them gone.

Removing the template itself works the same way, except that a few tests name it on purpose: `packages/candy-mountain/src/product.test.ts` (it checks that the template is in both apps) and the development-product cases of `apps/daemon/src/candy-mountain.test.ts`. Those tests change with it.
