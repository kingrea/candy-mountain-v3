# @candy-mountain/platform-web

This is the conventions document for capability layers and the shell they plug into. The `cm-layers` lint messages point here.

Every capability's UI is a Nuxt layer at the root of its capability package, `packages/cap-<capability-id>/`. A plugin type's UI lives in the layer of the capability package that brings it (see Plugin-type layers). One more layer, `chat`, is shared infrastructure rather than a capability. **Core** is the shell in this package (`@candy-mountain/platform-web`, itself a Nuxt layer that a distribution such as `apps/web` extends): its `app/`, the Nitro proxy (`server/`), `shared/`, the `chat` and `overview` layers under its own `layers/`, its tests and config. Core holds the platform's own pages (projects, settings) and plumbing; it never knows about a capability or a product plugin type, and it never imports a product: the distribution's `nuxt.config.ts` hands it the product configuration through the `platformWeb: { product }` option of the package's Nuxt module (`modules/platform-web.ts`), which the shell reads as `PRODUCT` (`shared/utils/product.ts`). `apps/web`, Candy Mountain's web distribution, holds only that config (with the product configuration from `@candy-mountain/candy-mountain`), its `package.json` (one dependency per capability package), `public/` and distribution-level tests.

## Registration

The web app registers exactly the layers the product configuration lists. `apps/web/nuxt.config.ts` spreads `layerListConfig(CANDY_MOUNTAIN_PRODUCT.layers, root)` from `@candy-mountain/platform-web/layer-list` (`packages/platform-web/layer-list.mjs`) and appends `@candy-mountain/platform-web` to its `extends`. Each id in the product configuration's `layers` (`packages/candy-mountain/src/product.ts`) resolves to a layer package the app depends on (below) or, in a distribution that keeps one, to a `layers/<id>/` directory of its own; the shell's own layers (`platformLayers()`: `chat`, `overview`) are listed too but resolve to nothing, since extending the shell brings them. A listed id that resolves to neither, that resolves to both, or whose package has no `nuxt.config` fails the build with an error naming it. A `layers/<id>/` directory that is not listed is dropped (with its `#layers/<id>` alias) in the `modules:before` hook, because Nuxt globs `layers/*` regardless. List order is layer priority (first wins). There is no glob-only mode: Nuxt's glob never registers a layer package.

- `apps/web/test/unit/distribution.test.ts` keeps the product list equal to the web app's layer packages plus the shell's own layers (`apps/web` has no `layers/` directory), checks each id resolves to its package directory and that every layer package with pages contributes its `/p/:project/<id>` route: a new layer's id goes into `CANDY_MOUNTAIN_PRODUCT.layers` and its package into `apps/web/package.json`.
- The layer id (the package's `webLayer`) is the capability id from the capability's manifest (lowercase kebab-case, e.g. `issues`, `agent-hub`), the plugin type id for a plugin-type layer (e.g. `repository`), or `chat`.
- Registration gives the layer the alias `#layers/<id>` pointing at its root, in Vite and in the generated tsconfig. The distribution's `nuxt typecheck` covers every registered layer's `app/**`.
- A layer's `app/app.config.ts` deep-merges into the app config (core wins on conflict). That is how a capability contributes to shared surfaces such as the chat layer without the chat layer importing it.

## Layer packages

Every capability's `packages/cap-<id>` is a layer package (see `packages/cap-repository`). A package is a layer package when:

- its `package.json` declares `"webLayer": "<id>"`, the layer id;
- it is a `dependencies` or `devDependencies` entry of the web app's `package.json`, found through `node_modules` from the web root (`link:` and `file:` specs resolve straight from the spec, without an install);
- its package root holds the layer's `nuxt.config.*`, with the directory shape below (`app/components`, `app/composables`, ...).

The package's real directory goes into `extends` with `meta.name` set to the id, which gives it the `#layers/<id>` alias.

A capability package (`packages/cap-<id>`, `packages/cap-repository` is the reference) is both the capability's daemon half and its layer: `src/` is the daemon side behind the root entry, and `nuxt.config.ts`, `app/` and `test/` at the package root are the layer. The layer imports the capability's wire types relatively from the package's own `src/wire.ts` (Node-free; the root entry re-exports it for the daemon side and for dependent capabilities); it never imports the package's root entry, which carries daemon code. The package lists `vue`, `zod` and whatever else the layer imports in its own `dependencies`. Its `nuxt.config.ts` adds the layer's `test/` to the distribution's app tsconfig (`typescript.tsConfig.include`), since `nuxt typecheck` of the distribution is what typechecks `app/` and `test/`; the package's own `tsc` covers `src/` only, and its `vitest.config.ts` runs `src/**/*.test.ts` and `test/**/*.test.ts`. `packageLayers(root)` in `packages/platform-web/layer-list.mjs` is the single discovery both Nuxt and the boundary lint use.

## Directory shape

```
packages/cap-<id>/
  package.json               "webLayer": "<id>"
  src/                       the daemon side (root entry); src/wire.ts is Node-free and the layer may import it relatively
  nuxt.config.ts             components prefix; nothing else unless the layer needs it
  app/
    pages/p/[project]/<id>/  the layer's routes, /p/:project/<id>/... (see the scope prefix below)
    components/              registered as <Prefix><File>
    composables/             auto-imported; every export carries the prefix
    utils/                   auto-imported; every export carries the prefix
    types/                   not auto-imported; import via #layers/<id>/app/types/...
    plugins/                 Nuxt plugins; register panels, forms, icons, chat pieces, home cards, project form fields and rows, and other contributions
    assets/                  files the layer imports itself, such as a plugin type's icon
    app.config.ts            optional app config contributions
```

Only create the directories the layer uses. Nuxt scans `pages`, `components`, `composables`, `utils`, `layouts`, `middleware` and `plugins` in every layer's `app/`, so a stray file there is live. A minimal working layer is in `packages/platform-web/test/fixtures/layered-app/layers/alpha/`.

## The prefix

The prefix is the PascalCase layer id: `issues` -> `Issues`, `agent-hub` -> `AgentHub`. Nuxt merges every layer's auto-imports into one global namespace, so every name a layer registers must say which layer it came from.

- **Components**: configured in the layer's `nuxt.config.ts`, never by nesting a folder. `app/components/Board.vue` becomes `IssuesBoard`; subfolders still add segments (`components/card/Header.vue` -> `IssuesCardHeader`).

  ```ts
  export default defineNuxtConfig({
    components: [{ path: './components', prefix: 'Issues' }],
  })
  ```

- **Composables, utils, shared/utils, shared/types**: every export (functions, constants, types, interfaces, and a default export, which is named after the file) starts with the prefix in one of its casings: `useIssuesBoard`, `IssuesRow`, `issuesPath`, `ISSUES_PAGE_SIZE`. `formatRow` or `PAGE_SIZE` fail lint. `export *` is rejected because it hides the names.
- Check what Nuxt actually registered in `.nuxt/components.d.ts` and `.nuxt/imports.d.ts` after `pnpm --filter @candy-mountain/web exec nuxt prepare`.

## Routes

Every capability page is project scoped. Core owns `app/pages/p/[project].vue`, which resolves the project from the slug (404 state if unknown, remembers the selection, applies the `dashboard` layout) and renders `<NuxtPage />`. Nuxt merges pages from all layers into one tree, so a layer page at `app/pages/p/[project]/<id>/index.vue` (relative to the layer's root) becomes a child route at `/p/:project/<id>` rendered inside that parent: it gets the project check and the layout for free and reads the project with `useSelectedProject()`. A single-page layer may use `pages/p/[project]/<id>.vue` instead.

The `p` in those URLs is the product's scope prefix, `PRODUCT.scope.urlPrefix` (`p` for Candy Mountain), not the directory name. Pages always live under `app/pages/p/`, in core and in every layer (`SCOPE_PAGES_DIR` in `packages/platform-web/scope-routes.mjs`); the platform-web Nuxt module's `pages:extend` hook moves the routes generated from that directory to `/<prefix>/`, and `projectPath` and `projectSwitchPath` in core's `app/utils/project-scope.ts` build links with the same prefix. A product with another prefix serves every scoped page there and `/p/` answers not found; no page moves and route names keep the directory's `p-project-...`. Never write `/p/` into a link: build it with `projectPath`. `packages/platform-web/test/unit/scope-routes.test.ts` loads the shell's page tree (through the package's `playground/`) and proves both. URLs the daemon writes (registry view `to`, activity and notification links, from `workspaceViewRoute`, and `chatThreadLink` in `@candy-mountain/platform-sdk`, `uptimeMonitorLink` in `@candy-mountain/cap-uptime`) still say `/p/` until the daemon reads the product configuration.

Pages outside `p/[project]/<id>/` fail lint, which also keeps two layers from ever claiming the same route. The one exception is the project home, `/p/:project`: it belongs to the `overview` layer (its view path is `''`), whose page is `layers/overview/app/pages/p/[project]/index.vue`. Core deliberately has no `p/[project]/index.vue` (two pages at one path would collide), and lint stops any other layer from adding one (`PROJECT_HOME_LAYER` in the lint plugin). Overview belongs to no module and grants every role `read` (`everyoneRung`), so the home is always there and leads the sidebar. Build links with `projectPath(slug, '<id>', ...)` from core. The chat layer is not bound to this rule.

## Views, the sidebar and the gate

A manifest view's `path` is its route relative to the project, so a view with `path: 'bots'` is the layer page `app/pages/p/[project]/bots/index.vue` (or `bots.vue`), and `path: 'issues/detail'` is `.../issues/detail.vue`. A view path must therefore start with its capability id, since `layer-pages` only allows a layer's pages under `p/[project]/<id>/`; the only `''` path (the project home) is Overview's. The daemon's registry answer (`GET /workspaces/:slug/registry`) carries each view's absolute `to`, and core renders the sidebar from it: there is no route table or nav list to edit, and a view the manifest does not declare never appears in the sidebar.

View paths cannot hold route params, so a page for one item is an undeclared child route of its list view, gated with that view's id: `issues/[id].vue` (`/p/:project/issues/:id`) wraps itself in `<CapabilityViewGate capability="issues" view="issues">`.

Every capability page wraps its root `UDashboardPanel` in core's `CapabilityViewGate` with the capability id and the manifest view id. The gate renders the page only when the actor's rung shows the view and the capability is ready for the project; otherwise it renders a soft lockout listing what to configure (with a link to the project's Plugins page), a "not enabled" state pointing at Modules, or a "not available to you" state.

```vue
<!-- packages/cap-bots/app/pages/p/[project]/bots/index.vue -->
<template>
  <CapabilityViewGate capability="bots" view="bots">
    <UDashboardPanel id="bots">
      <template #header>
        <UDashboardNavbar title="Bots" />
      </template>
      <template #body>
        <BotsList />
      </template>
    </UDashboardPanel>
  </CapabilityViewGate>
</template>
```

The page's own `<script setup>` runs even when the gate locks it, so fetch data in components inside the slot (`BotsList` above), not in the page, or those requests hit the daemon's capability gate. The slot also receives `capability` (with its `rung`) and `view` from the registry. Read the registry elsewhere with core's `useProjectRegistry()`, and call `refreshProjectRegistry()` after anything that changes modules, plugins or grants.

## Dependency directions

Allowed: capability -> core, capability -> chat, chat -> core, core -> chat.

Forbidden: capability -> capability, chat -> capability, core -> capability.

This covers explicit imports and auto-imported names alike: using another capability's component tag or composable is a violation even with no import statement. Packages are never restricted, except layer packages (see Layer packages); wire types shared between capabilities belong in `@candy-mountain/platform-sdk`, never in a layer.

Import aliases:

- `#layers/<id>/...`: a layer's own non-auto-imported files, and the chat layer's files from anywhere.
- `~/...`: core files only. Never reach a layer's own files through `~/`: Nuxt's `localLayerAliases` rewrites `~` inside a layer to the layer's own `app/` when a file exists at that path, while typecheck always resolves `~` to core. For the same reason, never create a layer file at a path that also exists in core.
- Components, composables and utils are auto-imported; import them explicitly only from `#components` / `#imports` in tests.
- API calls go through core's `useApi` / `$api` only.

## Boundary lint

`packages/platform-web/eslint/layer-boundaries.mjs` (exported as `@candy-mountain/platform-web/eslint`) is a local ESLint plugin, `cm-layers`; its `layerBoundaries(import.meta.url)` block enables every rule as an error for every script and `.vue` file under the linted root, in `apps/web/eslint.config.mjs` and in the package's own `eslint.config.mjs`. It runs with `pnpm lint` from the repo root. The allowed directions (`ALLOWED`) and the shared layer name (`SHARED_LAYER`) are declared at the top of that file; nothing lists the capabilities: the lint's layers are the shell's own `layers/*` inside the platform package (`platformLayers`), the linted root's `layers/*` directories with a `nuxt.config` (a distribution may still keep some; `apps/web` has none), and the layer packages the root depends on (`packageLayers`, above). Discovery reads `package.json` files only, never the product's layer list.

A layer package is linted when the pipeline lints that package, from its own root, and reports what linting it from the app would. Its `eslint.config.js` is one call, and its `package.json` lists `"@candy-mountain/platform-web": "workspace:*"` in `devDependencies` (a lint and test config may import platform presets; layer code may not):

```js
// packages/cap-<id>/eslint.config.js
import base from '@candy-mountain/platform-config/eslint'
import { layerPackageConfig } from '@candy-mountain/platform-web/eslint'

export default layerPackageConfig(import.meta.url, ...base)
```

`layerPackageConfig` throws unless the package's `package.json` declares `"webLayer"`. It applies Nuxt's ESLint rules (the ones `apps/web` gets from its generated config) to the layer's files, the given configs to everything, and the `cm-layers` rules as follows. A root whose `package.json` declares `"webLayer": "<id>"` is that layer, not core. Its app is every workspace package (from the nearest `pnpm-workspace.yaml`) that depends on both it and `@candy-mountain/platform-web`: that app's `layers/*` directories and layer packages count, and `~/`, `~~/` resolve into it. Every workspace layer package is a sibling layer, listed by the app or not. The package's `src/` (`DAEMON_SOURCE`) is its daemon side and obeys the daemon rule set instead; layer files that import it are the layer's own.

- `cm-layers/no-cross-layer-import`: `import`, `export ... from`, `import()`, `import('...')` types, `require()` and `vi.mock` & co., resolved through relative paths, `#layers/<id>/`, `~/` / `@/` (core `app/`), `~~/` / `@@/` (the web root) and absolute paths. Named imports from `#components` and `#imports` are checked name by name.
- `cm-layers/no-cross-layer-auto-import`: component tags in templates (any spelling, `Lazy` included), free identifiers in scripts and template expressions, `resolveComponent` / `mockComponent` / `mockNuxtImport` names. It scans each registered layer's components and auto-imported exports to know who owns a name.
- `cm-layers/layer-prefix`: unprefixed exports in a layer's auto-imported files; a layer `nuxt.config` that registers components without its prefix; a layer directory that is not a kebab-case id.
- `cm-layers/layer-pages`: capability pages outside `app/pages/p/[project]/<id>/`.
- `cm-layers/no-platform-package-import`: a layer outside the platform package importing `@candy-mountain/platform-web` by package name (any subpath) or by a relative or absolute path into it. Core is reached through its auto-imports, `#imports`, `#components` and `#layers/platform-web/...`, never the package line. A layer's root `eslint.config.*` and `vitest.config.*` are exempt.

Ownership comes from where a file lives, not its name: a file under a layer package's real root belongs to that layer, a file under `layers/<id>/` of the platform package or of the web root to `<id>`, any other file under the platform package or the web root to core. For a layer package, `#layers/<id>/...` resolves into the package, and an import by the package's name (`@scope/pkg`, its root entry included, or `@scope/pkg/...`) or by a relative path into it is checked like any other layer import, so one layer package using another fails `no-cross-layer-import` even when its `package.json` lists the other for the daemon side; other packages stay unrestricted. Fix a violation by moving code to the side that owns it, registering through app config, or moving a shared type into `@candy-mountain/platform-sdk`; do not disable the rule. `packages/platform-web/test/unit/layer-boundaries.test.ts` lints the fixture app in `packages/platform-web/test/fixtures/layered-app/`, its linked layer packages `test/fixtures/delta-layer/` and `test/fixtures/epsilon-layer/` (a capability package's shape, with a daemon `src/`), and `test/fixtures/platform-layer/`, which stands in for the shell (core plus `chat` and `overview` layers, pointed at through the `cm-layers` setting `platform`); `test/fixtures/pnpm-workspace.yaml` is their workspace. All are ignored by the normal lint. The test asserts each rule fires for directory layers, package layers and the layers inside the platform package alike, the package-to-package and package-to-platform cases, and that linting each layer package from its own root reports the same findings as linting the app.

## Plugin-type layers

A plugin type that no capability with views owns (today `repository` and `slack`) still has UI: an icon, perhaps a panel on the Plugins page or a setup form. That UI lives in a plugin-type layer named after the plugin type id. It has no manifest and no pages; it holds components, assets and a Nuxt plugin that registers them through core's registration functions, so core never names the plugin type.

```ts
// packages/cap-repository/app/plugins/repository.ts
export default defineNuxtPlugin(() => {
  registerPluginPanel('repository', defineAsyncComponent(() => import('#layers/repository/app/components/Panel.vue')))
  registerPluginIcon('repository', { name: 'i-lucide-git-branch' })
})
```

`registerPluginIcon(typeId, icon)` sets the icon `PluginsIcon` shows beside the type's name everywhere a plugin is listed: either `{ name }`, an icon name as `UIcon` takes it, or `{ src, class? }`, an image URL (an SVG under the layer's `app/assets/`, imported with `?url`) plus classes for the `<img>`. A type nobody registers shows core's generic plug. A plugin type a capability owns (such as `claude-code`) registers its icon, panel and form from that capability's layer instead, the same way. Name a layer's Nuxt plugin after the layer, never after a core plugin file (see the `~/` alias above). For the boundary lint a plugin-type layer is a capability layer: the same dependency directions and the same prefix rule (`RepositoryPanel` above), and `layer-pages` would only allow pages under `p/[project]/<id>/`, which it should not have.

## Project home cards

The project home (`/p/:project`, the overview layer's page) is platform: it shows the project's own facts, its enabled modules, plugin health and the activity feed, and knows no product capability or plugin type. A layer adds a card to it with core's `registerProjectHomeCard(slot, card)` (`app/utils/project-home.ts`, auto-imported), called from the contributing layer's own Nuxt plugin. The registration lives in core because the overview is a capability layer and capabilities may not use each other's names.

```ts
// packages/cap-repository/app/plugins/repository.ts
export default defineNuxtPlugin(() => {
  registerProjectHomeCard('facts', {
    id: 'repository',
    component: defineAsyncComponent(() => import('#layers/repository/app/components/Facts.vue')),
  })
})
```

The slots (`PROJECT_HOME_CARD_SLOTS`) are named places on the page:

- `facts`: the narrow column, directly under the project's facts card (organisation) and above Modules.
- `aside`: the narrow column, after Plugins.
- `main`: the wide column, after Activity.

`card.id` is unique within a slot, usually the contributing layer's id; registering the same id in the same slot again replaces the earlier card in its place. Cards in one slot render in registration order, and a slot nobody fills renders nothing, so removing a layer removes its cards. A card takes no props: it reads the project with core's `useSelectedProject()`, fetches its own data, renders its own `UCard` and renders nothing while it has nothing to show. The repository plugin-type layer contributes the repository facts (path, remote, issues tracked, checked) to `facts` this way. `layers/overview/test/unit/plugin-types.test.ts` guards that the overview layer itself names no plugin type, repository source or path verification.

## Projects page contributions

The Projects page (core's `app/pages/projects.vue`, its form modal and list) is platform: a project there has a name, slug, colour, organisation and archived state, and nothing else. Product data about a project, such as Candy Mountain's repository path, comes from layers through two contribution points, both in core and auto-imported, both called from the contributing layer's own Nuxt plugin.

**Form fields** (`app/utils/project-form.ts`). `registerProjectFormField(field)` adds a field to the create/edit modal, after core's own fields, in registration order; registering the same `name` again replaces the earlier field in its place.

- `name`: the field's key in the form state and the `name` of the `UFormField` its component renders.
- `component`: receives `v-model` (the value) and `ProjectFormFieldProps` (`project`, null while creating, and `open`), and renders its own `UFormField` so core's `UForm` validates and shows errors on it.
- `schema`: a zod schema for the value, merged into core's form schema, so the field validates with the rest of the form on submit.
- `initial(project)`: the value when the modal opens.
- `request(value, project)` (optional): fields merged into the create (project null) or update request body.
- `errorCodes` (optional): API error codes core shows on this field instead of above the form.
- `afterSave(project, { value, created })` (optional): runs after the create or update succeeded, with the saved project, for a layer that writes its own data through its own API. It may answer a `ProjectFormSaveNote` (`description`, `color`) that the page adds to its save toast. A throw keeps the modal open with the error; the project is already saved, so submitting again updates it rather than creating another.
- `description` (optional): `{ create, edit }` copy for the modal's description; the first field that sets one wins, and with none the modal has no description.

**Row items and actions** (`app/utils/project-list.ts`). `registerProjectRowItem(slot, item)` adds a component to every row of the list; it takes `ProjectRowItemProps` (`project`). The slots (`PROJECT_ROW_SLOTS`) are `detail`, under the name and slug, and `badges`, beside the row's actions menu; `item.id` is unique within a slot and items render in registration order. `registerProjectRowAction(action)` adds an entry to each row's actions menu after Edit: `run(project)` is awaited by the page, a throw shows above the list, the page refreshes the projects either way, and an answered `ProjectRowActionNote` (`title`, `description`) becomes a toast.

With nothing contributed the form has only core's fields and the rows only the name, slug, archived badge and core's actions (`packages/platform-web/test/unit/project-form.test.ts`). The repository layer (`packages/cap-repository`) contributes the local path field with its live path check (`POST /workspaces/repository/check`), the path under each row's name, the verification facts beside the menu and the "Re-check path" action (`POST /workspaces/:slug/repository/verify`). The project body carries no path: the field's `afterSave` writes it with `PUT /workspaces/:slug/repository` once the project is saved, and the row items, the facts card and the form read the stored repository through the layer's `useRepository(slug)` composable (`GET /workspaces/:slug/repository`, null when the workspace has none; keyed `repository:<slug>`, so core's `refreshProjectData()` refreshes it too):

```ts
// packages/cap-repository/app/plugins/repository.ts
export default defineNuxtPlugin((nuxtApp) => {
  const api: RepositoryApi = (path, options) => nuxtApp.$api(path, options)
  registerProjectFormField(repositoryFormField(defineAsyncComponent(() => import('#layers/repository/app/components/FormPath.vue')), api))
  registerProjectRowItem('detail', { id: 'repository', component: defineAsyncComponent(() => import('#layers/repository/app/components/RowPath.vue')) })
  registerProjectRowItem('badges', { id: 'repository', component: defineAsyncComponent(() => import('#layers/repository/app/components/RowFacts.vue')) })
  registerProjectRowAction(repositoryRecheckAction(api))
})
```

## Chat contributions

The chat layer is platform: it renders a thread of any agent family and knows no family by name. A capability layer adds to it through two registration functions, both auto-imported from the chat layer and both called from the contributing layer's own Nuxt plugin (never from the chat layer, which may not import a capability):

- `chatRailRegister(source)` adds entries to the chat rail that are not registry agents (`ChatRailSource` in `layers/chat/app/utils/chatRail.ts`). Each such entry brings its own `panel` component.
- `chatFamilyRegister(family, pieces)` adds components to every thread whose agent has that session family (`layers/chat/app/utils/chatFamilies.ts`). `pieces.id` is the contributing layer's id (registering the same id again replaces the earlier pieces); the other fields name a slot of the agent panel: `aboveTranscript`, between the panel header and the transcript, and `promptBar`, in the prompt bar's footer. Several layers may contribute to one family and render in registration order. The chat layer renders whatever is registered for the current thread's family and nothing for a family with no pieces.

```ts
// layers/chat-claude-code/app/plugins/chat-claude-code.ts
export default defineNuxtPlugin(() => {
  chatFamilyRegister('claude-code', {
    id: 'chat-claude-code',
    promptBar: defineAsyncComponent(() => import('#layers/chat-claude-code/app/components/ModelEffort.vue')),
  })
})
```

Every piece receives the thread on screen as its `thread` prop, a `ChatFamilyThread`: `slug`, `agentId`, `agent` (the registry agent, once listed), `threadId` (null for a draft), `thread`, `sessions` (oldest first), `working`, plus what the piece may do: `setDraft(fields)` sets the fields a draft thread is created with besides its agent (`model`, `effort`, ...; `draft` reads them back), `setSessionDividers(labels)` sets the divider text per session id shown in the transcript above a session that replaced an earlier one, `update(body)` changes an existing thread and keeps a replaced session's log on screen, and `refresh()` re-reads it and the thread list. The panel clears the draft and the dividers when the thread or agent changes. A piece fetches its own data with its own composables, renders nothing when it has nothing to show, and reports its own failures (toasts); the chat layer never knows what it does. A piece that needs a product field of the thread response reads it from `useChatThread(slug, threadId).response`, which shares the panel's request. The Claude Code and Codex layers each contribute their model and effort selector this way, labelling the session dividers from the options the daemon reports. The bots layer registers its worktree card under every family in `BOT_FAMILIES` (a bot agent carries its engine's family) and shows it only when `thread.agent` is a bot. `layers/chat/test/unit/families.test.ts` guards that the chat layer itself names no product family, bot or worktree.

## Adding a capability layer

1. Create or extend the capability package `packages/cap-<id>` (its daemon definition is the other half; see `apps/daemon/README.md`) with `"webLayer": "<id>"`, the `eslint.config.js` shown under Boundary lint and `nuxt.config.ts` with `components: [{ path: './components', prefix: '<Prefix>' }]`.
2. Add pages under `app/pages/p/[project]/<id>/` at each manifest view's `path`, each wrapped in `CapabilityViewGate`; components under `app/components/`, prefixed composables and utils.
3. Add the id to `layers` in `packages/candy-mountain/src/product.ts` and `"@candy-mountain/cap-<id>": "workspace:*"` to `apps/web/package.json`, then `pnpm install` (which runs `nuxt prepare` and regenerates aliases, types and the ESLint globals); check `apps/web/.nuxt/components.d.ts` and `.nuxt/imports.d.ts` for the expected names.
4. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`.

No other central file changes: no `extends` entry, no lint list, no route map. Removing a layer is the reverse: drop the id and the dependency, and the package with it.
