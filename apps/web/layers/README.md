# Web layers

Every capability's UI is a Nuxt layer under `apps/web/layers/<capability-id>/`. One more layer, `chat`, is shared infrastructure rather than a capability. Everything in `apps/web` outside `layers/` is **core**: the shell (`app/`), the Nitro proxy (`server/`), tests and config. Core holds the platform's own pages (projects, settings) and plumbing; it never knows about a capability.

## Registration

- Nuxt 4 globs `apps/web/layers/*` and registers each directory that has a `nuxt.config.ts` as a layer named after the directory. There is no `extends` list in `apps/web/nuxt.config.ts`, and none should be added. A directory without a `nuxt.config.ts` is skipped entirely.
- The directory name is the capability id from the capability's manifest (lowercase kebab-case, e.g. `issues`, `agent-hub`), or `chat`.
- Registration gives the layer the alias `#layers/<id>` pointing at its root, in Vite and in the generated tsconfig. `nuxt typecheck` already covers `layers/*/app/**`.
- A layer's `app/app.config.ts` deep-merges into the app config (core wins on conflict). That is how a capability contributes to shared surfaces such as the chat layer without the chat layer importing it.

## Directory shape

```
layers/<id>/
  nuxt.config.ts             components prefix; nothing else unless the layer needs it
  app/
    pages/p/[project]/<id>/  the layer's routes, /p/:project/<id>/...
    components/              registered as <Prefix><File>
    composables/             auto-imported; every export carries the prefix
    utils/                   auto-imported; every export carries the prefix
    types/                   not auto-imported; import via #layers/<id>/app/types/...
    app.config.ts            optional contributions (chat registration etc.)
```

Only create the directories the layer uses. Nuxt scans `pages`, `components`, `composables`, `utils`, `layouts`, `middleware` and `plugins` in every layer's `app/`, so a stray file there is live. A minimal working layer is in `apps/web/test/fixtures/layered-app/layers/alpha/`.

## The prefix

The prefix is the PascalCase capability id: `issues` -> `Issues`, `agent-hub` -> `AgentHub`. Nuxt merges every layer's auto-imports into one global namespace, so every name a layer registers must say which layer it came from.

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

This covers explicit imports and auto-imported names alike: using another capability's component tag or composable is a violation even with no import statement. Packages are never restricted; wire types shared between capabilities belong in `@candy-mountain/shared`, never in a layer.

Import aliases:

- `#layers/<id>/...`: a layer's own non-auto-imported files, and the chat layer's files from anywhere.
- `~/...`: core files only. Never reach a layer's own files through `~/`: Nuxt's `localLayerAliases` rewrites `~` inside a layer to the layer's own `app/` when a file exists at that path, while typecheck always resolves `~` to core. For the same reason, never create a layer file at a path that also exists in core.
- Components, composables and utils are auto-imported; import them explicitly only from `#components` / `#imports` in tests.
- API calls go through core's `useApi` / `$api` only.

## Boundary lint

`apps/web/eslint/layer-boundaries.mjs` is a local ESLint plugin, `cm-layers`, enabled as errors for every script and `.vue` file under `apps/web` by `apps/web/eslint.config.mjs`. It runs with `pnpm lint` from the repo root. The allowed directions (`ALLOWED`) and the shared layer name (`SHARED_LAYER`) are declared at the top of that file; nothing lists the capabilities, because the layer directories are the list.

- `cm-layers/no-cross-layer-import`: `import`, `export ... from`, `import()`, `import('...')` types, `require()` and `vi.mock` & co., resolved through relative paths, `#layers/<id>/`, `~/` / `@/` (core `app/`), `~~/` / `@@/` (the web root) and absolute paths. Named imports from `#components` and `#imports` are checked name by name.
- `cm-layers/no-cross-layer-auto-import`: component tags in templates (any spelling, `Lazy` included), free identifiers in scripts and template expressions, `resolveComponent` / `mockComponent` / `mockNuxtImport` names. It scans each registered layer's components and auto-imported exports to know who owns a name.
- `cm-layers/layer-prefix`: unprefixed exports in a layer's auto-imported files; a layer `nuxt.config` that registers components without its prefix; a layer directory that is not a kebab-case id.
- `cm-layers/layer-pages`: capability pages outside `app/pages/p/[project]/<id>/`.

Ownership comes from where a file lives, not its name. Fix a violation by moving code to the side that owns it, registering through app config, or moving a shared type into `@candy-mountain/shared`; do not disable the rule. `apps/web/test/unit/layer-boundaries.test.ts` lints the fixture app in `apps/web/test/fixtures/layered-app/` (ignored by the normal lint) and asserts each rule fires.

## Adding a capability layer

1. Declare the capability's manifest in the daemon; its id is the layer name.
2. Create `apps/web/layers/<id>/nuxt.config.ts` with `components: [{ path: './components', prefix: '<Prefix>' }]`.
3. Add pages under `app/pages/p/[project]/<id>/` at each manifest view's `path`, each wrapped in `CapabilityViewGate`; components under `app/components/`, prefixed composables and utils.
4. Run `pnpm --filter @candy-mountain/web exec nuxt prepare` (regenerates aliases, types and the ESLint globals), then check `.nuxt/components.d.ts` and `.nuxt/imports.d.ts` for the expected names.
5. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`.

No central file changes: no `extends` entry, no lint list, no route map.
