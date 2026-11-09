# Candy Mountain

A pnpm workspace (`apps/*`, `packages/*`) whose tasks run through [Turborepo](https://turborepo.com). Every package is private and depends on its siblings with `workspace:*`. The platform itself is not here: it is installed from the private registry as the `@crab-shack/platform-*` packages (see [The platform](#the-platform)).

## Layout

Candy Mountain's capabilities as packages, the product as data, and thin apps that assemble them with the installed platform.

| Package | What it is |
| --- | --- |
| `packages/claude-acp` | The Claude Code ACP shim. |
| `packages/testing` | Test support that several packages' tests share: the fake ACP agent and `claude`, the fake GitHub and Bitbucket, and stand-in `repository` and `claude-code` definitions. Not a capability and depends on no capability, so any capability lists it in `devDependencies` and its tests import its root entry; a capability's root entry never exports test support. |
| `packages/cap-<id>` | One package per feature capability (`issues`, `chat-claude-code`, `chat-codex`, `bots`, `team`, `uptime`, `deployments`) or service-only capability that brings no plugin type (`acp`): its daemon definition on the root entry, its schema and migrations, and its Nuxt layer when it has UI. It never brings plugin types. The worked example to copy when starting one is the platform's `packages/cap-template`, whose README is the capability author's guide. |
| `packages/plugin-<id>` | One connection package per plugin type (`repository`, `slack`, `claude-code`, `codex`, `heroku`, `netlify`): a service-only definition (no manifest) whose id is the plugin type's id, with the type, its services and its Nuxt layer (icon, form, panel). The only kind of package that brings plugin types. |
| `packages/candy-mountain` | The product as plain data: `CANDY_MOUNTAIN_PRODUCT` and the module definitions. |
| `apps/daemon` | The daemon distribution: `runDaemon` over the product package and the capability definitions listed in `src/definitions.ts`, plus the product's own tests. |
| `apps/web` | The web distribution: a `nuxt.config.ts` extending `@crab-shack/platform-web` and every layer the product lists, resolved from the capability packages in its `package.json`. |
| `apps/cli` | The `candy-mountain` bin: `runCli` with this repository's paths and the product. |

Dependencies point one way: apps depend on capability packages, the product package and the platform; capability packages on the platform (its declared entries only) and on the capability packages their definition's `dependsOn` names; the platform on nothing of the product. `pnpm lint` enforces it (`cm-packages` for script files, explained in the platform's `packages/platform-daemon/README.md`; `cm-layers` for the web layers, explained in its `packages/platform-web/README.md`). Only a `plugin-*` package brings plugin types: its definition has no manifest and brings the plugin type named by its id, and a `cap-*` package brings none. Adding or removing a capability is described in `apps/daemon/README.md` ("Adding or removing a capability"): the package, its dependency line in each app's `package.json`, its entry in `apps/daemon/src/definitions.ts`, and its ids in the product package.

## The platform

The daemon platform, the web shell, the SDK, the tooling presets and the CLI live in the base repository, [crab-shack/platform](https://github.com/crab-shack/platform), and are published to GitHub Packages as `@crab-shack/platform-daemon`, `@crab-shack/platform-web`, `@crab-shack/platform-sdk`, `@crab-shack/platform-config` and `@crab-shack/platform-cli`. They share one version line and this repository pins them to one exact version in every `package.json` that uses them; upgrading is changing that version everywhere and running `pnpm install`. Their READMEs are the conventions documents: `packages/platform-daemon/README.md` for a capability's daemon half, `packages/platform-web/README.md` for its layer and the theme contract, and `packages/cap-template/README.md` for the capability author's guide, all in the base.

The committed `.npmrc` maps the `@crab-shack` scope to `https://npm.pkg.github.com`; everything else resolves from the public registry. Installing needs a read-only token in your user-level `~/.npmrc` (never in this repository), as the base's `docs/registry-access.md` describes:

```ini
//npm.pkg.github.com/:_authToken=<a classic personal access token with read:packages>
```

A fix the platform needs is made in the base and released as a patch, never patched, vendored or overridden here.

## Commands

Run from the repo root:

| Command | What it runs |
| --- | --- |
| `pnpm install` | Installs the workspace, with the platform packages from the registry (see [The platform](#the-platform)); the web app's `postinstall` runs `nuxt prepare`, which its lint and typecheck need. |
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
- `test`, `lint` and `typecheck` depend on dependencies' `transit`, a task no package defines: it orders nothing but carries each dependency's files into the hash. Workspace packages export TypeScript source, so these tasks need no prior build; the installed platform packages are already built.
- `CM_*` variables are part of the `build` and `test` hashes (plus `NUXT_*` for build and `CLAUDE_ACP_TEST_BIN` for test); other environment variables pass through without affecting the cache.

## Adding a package

Put it under `apps/` or `packages/`, depend on `@crab-shack/platform-config` (the pinned platform version, dev dependency) and extend its presets in `tsconfig.json`, `eslint.config.*` and `vitest.config.ts` (see the package's README in the base). Then declare the scripts the pipeline runs; a package without one of them is skipped for that task:

```json
"scripts": {
  "build": "tsdown",
  "typecheck": "tsc --noEmit",
  "lint": "eslint .",
  "test": "vitest run"
}
```

A package with nothing to build leaves out `build`. Its tests are found by its own `vitest.config.ts`; there is no root list to register in.
