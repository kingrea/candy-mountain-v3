# Web layers

Every capability's UI is a Nuxt layer under `apps/web/layers/<capability-id>/`. A plugin type that belongs to no capability gets a plugin-type layer under `apps/web/layers/<plugin-type-id>/` (see below). One more layer, `chat`, is shared infrastructure rather than a capability. Everything in `apps/web` outside `layers/` is **core**: the shell (`app/`), the Nitro proxy (`server/`), tests and config. Core holds the platform's own pages (projects, settings) and plumbing; it never knows about a capability or a product plugin type.

## Registration

The web app registers its layers in one of two modes.

- **Glob (default, development in this repo).** Nuxt 4 globs `apps/web/layers/*` and registers each directory that has a `nuxt.config.ts` as a layer named after the directory. Do not hand-write an `extends` list in `apps/web/nuxt.config.ts`. A directory without a `nuxt.config.ts` is skipped entirely, so deleting a layer directory removes the layer.
- **Explicit (a distribution).** With `CM_WEB_LAYERS=product`, `nuxt.config.ts` spreads `layerListConfig(PRODUCT.layers, root)` from `apps/web/layer-list.mjs`. The layers become exactly the ids in the product configuration's `layers` (`packages/shared/src/product.ts`), each resolved to `layers/<id>/` or to a layer package (below). A listed id that resolves to neither, that resolves to both, or whose package has no `nuxt.config` fails the build with an error naming it. A `layers/<id>/` directory that is not listed is dropped (with its `#layers/<id>` alias) in the `modules:before` hook, because Nuxt globs `layers/*` regardless. List order is layer priority (first wins). Generated tsconfig globs still include `layers/*/app/**`, so typecheck the repo in glob mode.
- `test/unit/layer-list.test.ts` keeps the product list equal to the layer directories in this repo, so both modes build the same app: add a new layer's id to `CANDY_MOUNTAIN_PRODUCT.layers`.
- The directory name is the capability id from the capability's manifest (lowercase kebab-case, e.g. `issues`, `agent-hub`), the plugin type id for a plugin-type layer (e.g. `repository`), or `chat`.
- Registration gives the layer the alias `#layers/<id>` pointing at its root, in Vite and in the generated tsconfig. `nuxt typecheck` already covers `layers/*/app/**`.
- A layer's `app/app.config.ts` deep-merges into the app config (core wins on conflict). That is how a capability contributes to shared surfaces such as the chat layer without the chat layer importing it.

## Layer packages

A layer may live in a package instead of under `layers/` (nothing does yet). A package is a layer package when:

- its `package.json` declares `"webLayer": "<id>"`, the layer id;
- it is a `dependencies` or `devDependencies` entry of the web app's `package.json`, found through `node_modules` from the web root (`link:` and `file:` specs resolve straight from the spec, without an install);
- its package root holds the layer's `nuxt.config.*`, with the same directory shape as `layers/<id>/` below (`app/components`, `app/composables`, ...).

In explicit mode the package's real directory goes into `extends` with `meta.name` set to the id, which gives it the `#layers/<id>` alias a directory layer gets. In glob mode a layer package is not registered. `packageLayers(root)` in `apps/web/layer-list.mjs` is the single discovery both Nuxt and the boundary lint use.

## Directory shape

```
layers/<id>/
  nuxt.config.ts             components prefix; nothing else unless the layer needs it
  app/
    pages/p/[project]/<id>/  the layer's routes, /p/:project/<id>/... (see the scope prefix below)
    components/              registered as <Prefix><File>
    composables/             auto-imported; every export carries the prefix
    utils/                   auto-imported; every export carries the prefix
    types/                   not auto-imported; import via #layers/<id>/app/types/...
    plugins/                 Nuxt plugins; register panels, forms, icons, chat pieces, home cards and other contributions
    assets/                  files the layer imports itself, such as a plugin type's icon
    app.config.ts            optional app config contributions
```

Only create the directories the layer uses. Nuxt scans `pages`, `components`, `composables`, `utils`, `layouts`, `middleware` and `plugins` in every layer's `app/`, so a stray file there is live. A minimal working layer is in `apps/web/test/fixtures/layered-app/layers/alpha/`.

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

Every capability page is project scoped. Core owns `app/pages/p/[project].vue`, which resolves the project from the slug (404 state if unknown, remembers the selection, applies the `dashboard` layout) and renders `<NuxtPage />`. Nuxt merges pages from all layers into one tree, so a layer page at `layers/<id>/app/pages/p/[project]/<id>/index.vue` becomes a child route at `/p/:project/<id>` rendered inside that parent: it gets the project check and the layout for free and reads the project with `useSelectedProject()`. A single-page layer may use `pages/p/[project]/<id>.vue` instead.

The `p` in those URLs is the product's scope prefix, `PRODUCT.scope.urlPrefix` (`p` for Candy Mountain), not the directory name. Pages always live under `app/pages/p/`, in core and in every layer (`SCOPE_PAGES_DIR` in `apps/web/scope-routes.mjs`); the `pages:extend` hook in `nuxt.config.ts` moves the routes generated from that directory to `/<prefix>/`, and `projectPath` and `projectSwitchPath` in core's `app/utils/project-scope.ts` build links with the same prefix. A product with another prefix serves every scoped page there and `/p/` answers not found; no page moves and route names keep the directory's `p-project-...`. Never write `/p/` into a link: build it with `projectPath`. `test/unit/scope-routes.test.ts` loads the real page tree and proves both. URLs the daemon writes (registry view `to`, activity and notification links, from `projectViewRoute`, `chatThreadLink` and `uptimeMonitorLink` in `@candy-mountain/shared`) still say `/p/` until the daemon reads the product configuration.

Pages outside `p/[project]/<id>/` fail lint, which also keeps two layers from ever claiming the same route. The one exception is the project home, `/p/:project`: it belongs to the `overview` layer (its view path is `''`), whose page is `layers/overview/app/pages/p/[project]/index.vue`. Core deliberately has no `p/[project]/index.vue` (two pages at one path would collide), and lint stops any other layer from adding one (`PROJECT_HOME_LAYER` in the lint plugin). Overview belongs to no module and grants every role `read` (`everyoneRung`), so the home is always there and leads the sidebar. Build links with `projectPath(slug, '<id>', ...)` from core. The chat layer is not bound to this rule.

## Views, the sidebar and the gate

A manifest view's `path` is its route relative to the project, so a view with `path: 'bots'` is the layer page `app/pages/p/[project]/bots/index.vue` (or `bots.vue`), and `path: 'issues/detail'` is `.../issues/detail.vue`. A view path must therefore start with its capability id, since `layer-pages` only allows a layer's pages under `p/[project]/<id>/`; the only `''` path (the project home) is Overview's. The daemon's registry answer (`GET /projects/:slug/registry`) carries each view's absolute `to`, and core renders the sidebar from it: there is no route table or nav list to edit, and a view the manifest does not declare never appears in the sidebar.

View paths cannot hold route params, so a page for one item is an undeclared child route of its list view, gated with that view's id: `issues/[id].vue` (`/p/:project/issues/:id`) wraps itself in `<CapabilityViewGate capability="issues" view="issues">`.

Every capability page wraps its root `UDashboardPanel` in core's `CapabilityViewGate` with the capability id and the manifest view id. The gate renders the page only when the actor's rung shows the view and the capability is ready for the project; otherwise it renders a soft lockout listing what to configure (with a link to the project's Plugins page), a "not enabled" state pointing at Modules, or a "not available to you" state.

```vue
<!-- layers/bots/app/pages/p/[project]/bots/index.vue -->
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

This covers explicit imports and auto-imported names alike: using another capability's component tag or composable is a violation even with no import statement. Packages are never restricted, except layer packages (see Layer packages); wire types shared between capabilities belong in `@candy-mountain/shared`, never in a layer.

Import aliases:

- `#layers/<id>/...`: a layer's own non-auto-imported files, and the chat layer's files from anywhere.
- `~/...`: core files only. Never reach a layer's own files through `~/`: Nuxt's `localLayerAliases` rewrites `~` inside a layer to the layer's own `app/` when a file exists at that path, while typecheck always resolves `~` to core. For the same reason, never create a layer file at a path that also exists in core.
- Components, composables and utils are auto-imported; import them explicitly only from `#components` / `#imports` in tests.
- API calls go through core's `useApi` / `$api` only.

## Boundary lint

`apps/web/eslint/layer-boundaries.mjs` is a local ESLint plugin, `cm-layers`, enabled as errors for every script and `.vue` file under `apps/web` by `apps/web/eslint.config.mjs`. It runs with `pnpm lint` from the repo root. The allowed directions (`ALLOWED`) and the shared layer name (`SHARED_LAYER`) are declared at the top of that file; nothing lists the capabilities: the lint's layers are the `layers/*` directories with a `nuxt.config` plus the layer packages the web root depends on (`packageLayers`, above).

- `cm-layers/no-cross-layer-import`: `import`, `export ... from`, `import()`, `import('...')` types, `require()` and `vi.mock` & co., resolved through relative paths, `#layers/<id>/`, `~/` / `@/` (core `app/`), `~~/` / `@@/` (the web root) and absolute paths. Named imports from `#components` and `#imports` are checked name by name.
- `cm-layers/no-cross-layer-auto-import`: component tags in templates (any spelling, `Lazy` included), free identifiers in scripts and template expressions, `resolveComponent` / `mockComponent` / `mockNuxtImport` names. It scans each registered layer's components and auto-imported exports to know who owns a name.
- `cm-layers/layer-prefix`: unprefixed exports in a layer's auto-imported files; a layer `nuxt.config` that registers components without its prefix; a layer directory that is not a kebab-case id.
- `cm-layers/layer-pages`: capability pages outside `app/pages/p/[project]/<id>/`.

Ownership comes from where a file lives, not its name: a file under a layer package's real root belongs to that layer, a file under `layers/<id>/` to `<id>`, any other file under the web root to core. For a layer package, `#layers/<id>/...` resolves into the package, and an import by the package's name (`@scope/pkg/...`) is checked like any other layer import; other packages stay unrestricted. Fix a violation by moving code to the side that owns it, registering through app config, or moving a shared type into `@candy-mountain/shared`; do not disable the rule. `apps/web/test/unit/layer-boundaries.test.ts` lints the fixture app in `apps/web/test/fixtures/layered-app/` and its linked layer package `apps/web/test/fixtures/delta-layer/` (both ignored by the normal lint) and asserts each rule fires, for directory and package layers alike.

## Plugin-type layers

A plugin type that no capability with views owns (today `repository` and `slack`) still has UI: an icon, perhaps a panel on the Plugins page or a setup form. That UI lives in a plugin-type layer named after the plugin type id. It has no manifest and no pages; it holds components, assets and a Nuxt plugin that registers them through core's registration functions, so core never names the plugin type.

```ts
// layers/repository/app/plugins/repository.ts
export default defineNuxtPlugin(() => {
  registerPluginPanel('repository', defineAsyncComponent(() => import('#layers/repository/app/components/Panel.vue')))
  registerPluginIcon('repository', { name: 'i-lucide-git-branch' })
})
```

`registerPluginIcon(typeId, icon)` sets the icon `PluginsIcon` shows beside the type's name everywhere a plugin is listed: either `{ name }`, an icon name as `UIcon` takes it, or `{ src, class? }`, an image URL (an SVG under the layer's `app/assets/`, imported with `?url`) plus classes for the `<img>`. A type nobody registers shows core's generic plug. A plugin type a capability owns (such as `claude-code`) registers its icon, panel and form from that capability's layer instead, the same way. Name a layer's Nuxt plugin after the layer, never after a core plugin file (see the `~/` alias above). For the boundary lint a plugin-type layer is a capability layer: the same dependency directions and the same prefix rule (`RepositoryPanel` above), and `layer-pages` would only allow pages under `p/[project]/<id>/`, which it should not have.

## Project home cards

The project home (`/p/:project`, the overview layer's page) is platform: it shows the project's own facts, its enabled modules, plugin health and the activity feed, and knows no product capability or plugin type. A layer adds a card to it with core's `registerProjectHomeCard(slot, card)` (`app/utils/project-home.ts`, auto-imported), called from the contributing layer's own Nuxt plugin. The registration lives in core because the overview is a capability layer and capabilities may not use each other's names.

```ts
// layers/repository/app/plugins/repository.ts
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

1. Declare the capability's manifest in the daemon; its id is the layer name, and add it to `CANDY_MOUNTAIN_PRODUCT.layers`.
2. Create `apps/web/layers/<id>/nuxt.config.ts` with `components: [{ path: './components', prefix: '<Prefix>' }]`.
3. Add pages under `app/pages/p/[project]/<id>/` at each manifest view's `path`, each wrapped in `CapabilityViewGate`; components under `app/components/`, prefixed composables and utils.
4. Run `pnpm --filter @candy-mountain/web exec nuxt prepare` (regenerates aliases, types and the ESLint globals), then check `.nuxt/components.d.ts` and `.nuxt/imports.d.ts` for the expected names.
5. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`.

No other central file changes: no `extends` entry, no lint list, no route map. A plugin-type layer follows the same steps without the manifest and pages, plus a Nuxt plugin under `app/plugins/`.
