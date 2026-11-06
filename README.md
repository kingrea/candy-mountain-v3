# Candy Mountain

A pnpm workspace (`apps/*`, `packages/*`) whose tasks run through [Turborepo](https://turborepo.com). Every package is private and depends on its siblings with `workspace:*`.

## Layout

A reusable platform, Candy Mountain's capabilities as packages, the product as data, and thin apps that assemble them.

| Package | What it is |
| --- | --- |
| `packages/platform-daemon` | The daemon platform: database and migrations, secrets, auth, workspaces, registries, grants, threads, the platform agent, `startPlatform`, `createApp` and `runDaemon`. |
| `packages/platform-web` | The web shell as a Nuxt layer package, with the `chat` and `overview` layers, the contribution points, the layer-list helpers and the `cm-layers` lint. Its README is the conventions document for capability layers. |
| `packages/platform-sdk` | Wire types that cross the platform line, the product configuration type (root entry), and the define helpers and contract types for capabilities (`/daemon` entry). |
| `packages/platform-config` | Address and data directory resolution, plus the tsconfig, ESLint (with the `cm-packages` boundary lint) and vitest presets every package extends. |
| `packages/platform-cli` | The `start`/`stop`/`status`/`logs`/`install-service` CLI, taking the product and the apps' paths from a distribution. |
| `packages/claude-acp` | The Claude Code ACP shim. |
| `packages/cap-<id>` | One package per capability (`repository`, `issues`, `slack`, `chat-claude-code`, `chat-codex`, `bots`, `team`, `uptime`, `deployments`): its daemon definition on the root entry, its schema and migrations, its plugin types, and its Nuxt layer. |
| `packages/candy-mountain` | The product as plain data: `CANDY_MOUNTAIN_PRODUCT` and the module definitions. |
| `apps/daemon` | The daemon distribution: `runDaemon` over the product package and the capability definitions listed in `src/definitions.ts`, plus the product's own tests. |
| `apps/web` | The web distribution: a `nuxt.config.ts` extending `@candy-mountain/platform-web` and every layer the product lists, resolved from the capability packages in its `package.json`. |
| `apps/cli` | The `candy-mountain` bin: `runCli` with this repository's paths and the product. |

Dependencies point one way: apps depend on capability packages, the product package and the platform; capability packages on the platform (root entries only) and on the capability packages their definition's `dependsOn` names; the platform on nothing of the product. `pnpm lint` enforces it (`cm-packages` for script files, `cm-layers` for the web layers). Adding or removing a capability is described in `apps/daemon/README.md` ("Adding or removing a capability"): the package, its dependency line in each app's `package.json`, its entry in `apps/daemon/src/definitions.ts`, and its ids in the product package.

## Commands

Run from the repo root:

| Command | What it runs |
| --- | --- |
| `pnpm install` | Installs the workspace; the web app's and `packages/platform-web`'s `postinstall` run `nuxt prepare` (the latter on its `playground/`), which their lint and typecheck need. |
| `pnpm build` | `turbo run build`: each package's `build` after its workspace dependencies' builds. |
| `pnpm test` | `turbo run test`: each package's `vitest run`. |
| `pnpm lint` | `turbo run lint lint:root`: each package's `eslint .` plus the root's own files (`lint:root`). |
| `pnpm typecheck` | `turbo run typecheck --concurrency=1`: each package's typecheck, one package at a time. |
| `pnpm dev` | The apps' dev servers in parallel. |

Typecheck runs serially on purpose: parallel `tsc` and `nuxt typecheck` runs use enough memory to be killed on a developer machine. Do not raise its concurrency.

To run a task for one package and what it depends on, filter it: `pnpm turbo run test --filter=<package name>...`. `--force` ignores the cache; `--dry` shows the task graph and hashes without running anything.

## Caching

`turbo.json` declares the tasks. Results are cached locally in `.turbo/` (git-ignored, as are the per-package `.turbo/` log folders). A task's hash covers its package's files (git-tracked plus untracked, minus git-ignored) and, through the dependency graph, the files of every workspace package it depends on, so changing a package re-runs its own tasks and its dependents' and replays everything else from the cache. `pnpm turbo run <task> --dry` lists which tasks would miss.

- `build` depends on dependencies' `build` and caches `dist/**` and `.output/**`.
- `test`, `lint` and `typecheck` depend on dependencies' `transit`, a task no package defines: it orders nothing but carries each dependency's files into the hash. Packages export TypeScript source, so these tasks need no prior build.
- `CM_*` variables are part of the `build` and `test` hashes (plus `NUXT_*` for build and `CLAUDE_ACP_TEST_BIN` for test); other environment variables pass through without affecting the cache.

## Adding a package

Put it under `apps/` or `packages/`, depend on `@candy-mountain/platform-config` (`workspace:*`, dev dependency) and extend its presets in `tsconfig.json`, `eslint.config.*` and `vitest.config.ts` (see `packages/platform-config`). Then declare the scripts the pipeline runs; a package without one of them is skipped for that task:

```json
"scripts": {
  "build": "tsdown",
  "typecheck": "tsc --noEmit",
  "lint": "eslint .",
  "test": "vitest run"
}
```

A package with nothing to build leaves out `build`. Its tests are found by its own `vitest.config.ts`; there is no root list to register in.
