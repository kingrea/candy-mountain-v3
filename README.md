# Candy Mountain

A pnpm workspace (`apps/*`, `packages/*`) whose tasks run through [Turborepo](https://turborepo.com). Every package is private and depends on its siblings with `workspace:*`.

## Commands

Run from the repo root:

| Command | What it runs |
| --- | --- |
| `pnpm install` | Installs the workspace; the web app's `postinstall` runs `nuxt prepare`, which its lint and typecheck need. |
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
