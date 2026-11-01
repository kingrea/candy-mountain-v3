# Phase 4: Packages and distributions

**Capability:** The repo is a set of platform packages, a set of capability packages and two thin apps that assemble them. A capability can be deleted by removing its package and one line from each app. Turborepo runs the build, test, lint and typecheck graph.

## What and why

**Platform packages.** Move the platform half of the daemon (everything the overview's platform list names) into a daemon platform package that exports the start function, the app factory and the service and route helpers capabilities build on. Move the web shell, the chat layer and the platform pages into a web platform package that is itself a Nuxt layer, so a distribution extends it like any other layer. Move the shared types, the define helpers for capabilities and plugin types, and the product configuration type into an SDK package: this is the only package a capability may import from the platform. The existing config package becomes the platform config package (lint, tsconfig, vitest presets) every package in the workspace extends. The CLI becomes a platform package that takes the product name and the two apps' paths from configuration.

The daemon platform package owns its own schema and migrations folder from phase 2, and its migrations run first.

**Capability packages.** One package per capability, holding its daemon definition (phase 1), its schema and migrations (phase 2) and its Nuxt layer (phase 3) behind two entry points, one for each app. Chat for Claude Code and chat for Codex are small; keep them as capabilities but let them share the ACP session service through the definition's dependency declaration rather than merging them. Plugin types live in the capability package that needs them, except plugin types no capability owns, which get a small package of their own.

Where a capability's web layer and daemon code share types today through the shared package, those types move into the capability package and the SDK keeps only what crosses the platform line.

**Thin apps.** The daemon app becomes an entry point that builds the product configuration, lists the capability definitions and starts the platform. The web app becomes a Nuxt config that extends the web platform layer and each capability's layer, plus the product configuration. The daemon's own README and the CLI's README update to describe this shape.

**Boundary lint at the package line.** The layer boundary rules keep their directions and move from directory ownership to package ownership: a capability package imports from the SDK and its own files, never from the platform packages' internals or from another capability package. Enforce the daemon side the same way the web side is enforced today, so a daemon file reaching into a platform internal fails lint. Keep the existing fixture-based lint tests and extend them for the package case.

**Turborepo.** Add it with a pipeline for build, test, lint and typecheck that respects package dependencies and caches. The root scripts delegate to it. Nothing else about the workspace changes.

## Human test

Run lint, typecheck, test and build through Turborepo from the root and confirm they pass and a second run is served from cache. Start both apps and repeat the v3 plan's human tests for issues, chat, bots and uptime. Then delete the uptime capability package and its line from each app, run the full pipeline, start the apps and confirm Operations shows only deployments. Restore it. Finally, add a direct import from a capability package into a platform package's internal file and confirm lint fails naming the rule.
