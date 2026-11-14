# Candy Mountain

A product built on the Crab Shack platform: its description as data, its brand, and thin apps that assemble the installed platform with the installed capabilities. A pnpm workspace (`apps/*`, `packages/*`) whose tasks run through [Turborepo](https://turborepo.com). Neither the platform nor the capabilities are here. Both are installed from the private registry: the platform as the `@crab-shack/platform-*` packages (see [The platform](#the-platform)), and each capability and connection as its own `@crab-shack/cap-*` or `@crab-shack/plugin-*` package (see [The capabilities](#the-capabilities)).

## Layout

The product as data, and thin apps that join it with the installed platform and capabilities.

| Package | What it is |
| --- | --- |
| `packages/candy-mountain` | The product as plain data: `CANDY_MOUNTAIN_PRODUCT` (its name, theme and word for a workspace, and the ids of the capabilities, modules, plugin types and layers it includes), the module definitions and the product's settings. |
| `apps/daemon` | The daemon distribution: `runDaemon` over the product package and the capability definitions listed in `src/definitions.ts`, each imported from an installed capability package, plus the product's own tests. |
| `apps/web` | The web distribution: a `nuxt.config.ts` extending `@crab-shack/platform-web` and every layer the product lists, each found in an installed capability package named in its `package.json`, plus the brand assets under `public/`. |
| `apps/cli` | The `candy-mountain` bin: `runCli` with this repository's paths and the product. |

Dependencies point one way: the apps depend on the product package, the platform and the capability packages; the product package on the platform's SDK alone. `pnpm lint` enforces it (`cm-packages` for script files, explained in the platform's `packages/platform-daemon/README.md`: an installed capability is imported only where a `package.json` lists it, and only through its root entry; `cm-layers` for the web app, explained in its `packages/platform-web/README.md`).

## The capabilities

Candy Mountain's capabilities and connections are the shared ones. They are developed in [crab-shack/capabilities](https://github.com/crab-shack/capabilities) and published to GitHub Packages one package each, every package at its own version:

| Kind | Packages |
| --- | --- |
| Feature capability | `@crab-shack/cap-issues`, `@crab-shack/cap-chat-claude-code`, `@crab-shack/cap-chat-codex`, `@crab-shack/cap-bots`, `@crab-shack/cap-team`, `@crab-shack/cap-uptime`, `@crab-shack/cap-deployments` |
| Service-only capability | `@crab-shack/cap-acp` |
| Connection, bringing the plugin type its id names | `@crab-shack/plugin-repository`, `@crab-shack/plugin-slack`, `@crab-shack/plugin-claude-code`, `@crab-shack/plugin-codex`, `@crab-shack/plugin-heroku`, `@crab-shack/plugin-netlify` |

Each is pinned to one exact version in `apps/daemon/package.json` and in `apps/web/package.json`, the same version in both; taking a new version of a capability is changing those two lines and running `pnpm install` ([below](#taking-a-new-version-of-a-capability)). The Claude Code ACP shim, `@crab-shack/claude-acp`, is not listed: it arrives as a dependency of `@crab-shack/cap-acp` and `@crab-shack/cap-bots`, at the version `pnpm-lock.yaml` records.

A capability is part of Candy Mountain when every list names it: the two dependency lines, its entry in `apps/daemon/src/definitions.ts`, and its ids in the product package (`capabilities`, `layers`, `pluginTypes` for a connection, and a module for a feature). A missed list names itself: the daemon refuses to boot while the product data and the definitions disagree, naming the capability; `apps/daemon/src/capability-packages.test.ts` fails, naming the package, when a capability is installed but not in the definitions; and a capability the definitions import that the daemon's `package.json` does not list fails `pnpm lint` and `pnpm test`, by name too. `apps/daemon/README.md` has the steps for adding and removing one.

How a capability behaves (its routes, background work, tables, settings and environment variables) is described in its package's `README.md`, in the capabilities repository and in the installed package under `node_modules`. A capability's identity in a database is its id, never its package name: the capability ids, plugin type ids, layer ids, table names and migration histories are the ones these packages had when they lived in this repository, so a data directory from before then starts on this build without a migration.

A fix a capability needs is made in the capabilities repository and released, never patched, vendored or overridden here. A capability particular to Candy Mountain would live here, as `packages/cap-<id>` or `packages/plugin-<id>` under the `@candy-mountain` scope, beside the installed ones; there is none today.

### Taking a new version of a capability

Capabilities have independent versions, so one can move without the others.

1. See what exists. `pnpm view @crab-shack/cap-team versions` lists the published versions of one package (it uses your `~/.npmrc` token); the organisation's packages page, `https://github.com/orgs/crab-shack/packages`, lists them all, and the README of the capabilities repository has a generated catalogue of every package with its current version. From platform 0.10.0, `pnpm platform-list` lists the published capabilities from inside a product (this repository is on 0.9.1, so it does not have it yet).
2. Read what changed. Each package's `CHANGELOG.md` sits beside it in the capabilities repository (`packages/cap-<id>/CHANGELOG.md`) and is published inside the package, so after an install it is also at `node_modules/@crab-shack/cap-<id>/CHANGELOG.md`.
3. Change its version in both places Candy Mountain lists it, the same version in each: `apps/daemon/package.json` and `apps/web/package.json`. To find them:

   ```sh
   grep -rn '"@crab-shack/cap-team"' --include=package.json . --exclude-dir=node_modules
   ```

   A new version may raise a peer range on another capability (`cap-chat-claude-code` 0.1.1 wants `plugin-repository` `^0.1.1`); that one moves in both places too.
4. `pnpm install`. The lockfile changes; commit it with the two lines.
5. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`.

The Claude Code shim, `@crab-shack/claude-acp`, is not a line here: it arrives as a dependency of `@crab-shack/cap-acp` and `@crab-shack/cap-bots`, so it moves when one of those does.

### Trying an unreleased capability change

To see a change to a capability before it is released, link Candy Mountain to the local capabilities checkout, work there, then unlink. The commands come from the installed `@crab-shack/platform-config`; its `docs/linking.md` in the base is the full reference. Candy Mountain is not beside the `crab-shack/` folder, so the default locations find nothing: pass the path (or set `CAPABILITIES_CHECKOUT`). The checkout must be installed (`pnpm install` in it).

```sh
pnpm platform-link --capabilities /home/kingrea/work/crab-shack/capabilities
pnpm dev
pnpm platform-unlink
```

The link points every capability package Candy Mountain installs at its directory in the checkout, which runs from source: no build, and `pnpm dev` restarts the daemon and reloads the web app when a file there changes. While linked, Candy Mountain also runs the platform release that checkout pins, not the one pinned here. It changes `pnpm-workspace.yaml`, `pnpm-lock.yaml` and `node_modules` in Candy Mountain and nothing in either checkout; `package.json` files are untouched. Linking never adds a capability, only redirects the packages already installed (the shim, `@crab-shack/claude-acp`, among them, since the lockfile has it). The built daemon (`node apps/daemon/dist/index.mjs`) does not run linked: unlink to run it.

Unlink before committing. A linked state is never committed: `pnpm platform-check-linked` fails while it lasts, naming each file, `pnpm lint` runs it first, and `pnpm install` installs it as a `pre-commit` hook block. After `pnpm platform-unlink`, `git status` shows what it showed before the link.

A fix a capability needs is made in the capabilities repository and released, then taken here as above; the link is for trying it first.

## The platform

The daemon platform, the web shell, the SDK, the tooling presets and the CLI live in the base repository, [crab-shack/platform](https://github.com/crab-shack/platform), and are published to GitHub Packages as `@crab-shack/platform-daemon`, `@crab-shack/platform-web`, `@crab-shack/platform-sdk`, `@crab-shack/platform-config` and `@crab-shack/platform-cli`. They share one version line and this repository pins them to one exact version in every `package.json` that uses them; upgrading is changing that version everywhere and running `pnpm install`, as the base's `docs/upgrade-path.md` describes. Their READMEs are the conventions documents: `packages/platform-daemon/README.md` for a capability's daemon half, `packages/platform-web/README.md` for its layer and the theme contract, and `packages/cap-template/README.md` for the capability author's guide, all in the base.

The committed `.npmrc` maps the `@crab-shack` scope to `https://npm.pkg.github.com`, which serves the platform and the capabilities alike; everything else resolves from the public registry. Installing needs a read-only token in your user-level `~/.npmrc` (never in this repository), as the base's `docs/registry-access.md` describes:

```ini
//npm.pkg.github.com/:_authToken=<a classic personal access token with read:packages>
```

pnpm holds back any release younger than a day. `pnpm-workspace.yaml` exempts the `@crab-shack` scope with one entry, so a platform or capability release installs the day it is published; every other package keeps the minimum age.

A fix the platform needs is made in the base and released as a patch, never patched, vendored or overridden here.

## Commands

Run from the repo root:

| Command | What it runs |
| --- | --- |
| `pnpm install` | Installs the workspace, with the platform and capability packages from the registry (see [The platform](#the-platform)); the web app's `postinstall` runs `nuxt prepare`, which its lint and typecheck need. |
| `pnpm build` | `turbo run build`: each app's `build`. The daemon builds to `apps/daemon/dist/index.mjs`, which plain `node` starts and which imports the installed capabilities from `node_modules`; the web app builds to `apps/web/.output`. |
| `pnpm test` | `turbo run test`: each package's `vitest run`. |
| `pnpm lint` | `turbo run lint lint:root`: each package's `eslint .` plus the root's own files (`lint:root`). |
| `pnpm typecheck` | `turbo run typecheck --concurrency=1`: each package's typecheck, one package at a time. |
| `pnpm dev` | The apps' dev servers in parallel: the daemon on `127.0.0.1:4310` and the web app on `http://127.0.0.1:4300`. |

The web app's dev server listens on `127.0.0.1` only, as the daemon does, so it is reachable from this machine alone (under WSL, a browser on the Windows side still reaches it at `http://localhost:4300`). To reach it from another device, ask for it with `NUXT_HOST=0.0.0.0 pnpm dev`, or name one address instead of `0.0.0.0`. Under the default development auth strategy that exposes an admin session to everyone on that network: anyone who can reach the port reads and changes everything through the web app's proxy to the daemon.

Typecheck runs serially on purpose: parallel `tsc` and `nuxt typecheck` runs use enough memory to be killed on a developer machine. Do not raise its concurrency.

To run a task for one package and what it depends on, filter it: `pnpm turbo run test --filter=<package name>...`. `--force` ignores the cache; `--dry` shows the task graph and hashes without running anything.

## Caching

`turbo.json` declares the tasks. Results are cached locally in `.turbo/` (git-ignored, as are the per-package `.turbo/` log folders). A task's hash covers its package's files (git-tracked plus untracked, minus git-ignored) and, through the dependency graph, the files of every workspace package it depends on, so changing a package re-runs its own tasks and its dependents' and replays everything else from the cache. `pnpm turbo run <task> --dry` lists which tasks would miss.

- `build` depends on dependencies' `build` and caches `dist/**` and `.output/**`.
- `test`, `lint` and `typecheck` depend on dependencies' `transit`, a task no package defines: it orders nothing but carries each dependency's files into the hash. The product package exports TypeScript source, so these tasks need no prior build; the installed platform and capability packages are already built, and a change of their versions reaches the hash through `pnpm-lock.yaml`.
- `CM_*` variables are part of the `build` and `test` hashes (plus `NUXT_*` for build); other environment variables pass through without affecting the cache.

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
