# Phase 1: Platform shell

**Capability:** Candy Mountain starts as a service, I log in, and I can register my codebases and switch between them.

## What and why

**The daemon.** A single long-lived Hono process owns all platform state and all OS work: shelling out to `bd` and git, spawning agent CLIs, polling, websockets. It stores platform state in one SQLite database through Drizzle with migrations run on start, and secret values in an encrypted write-only store modelled on v2's (AES-GCM under a master key, never returned once written, deleted with their owner). Mastra is initialised as a library against the same database so later phases can register native agents without re-plumbing, but nothing is registered yet. The daemon's data directory (database, secrets, worktrees, agent config homes, logs) lives in one configurable location outside any repo, so moving to the home server is a copy.

**Runs like an app, not a dev server.** A small CLI starts, stops, restarts and tails the daemon, and can install it as a user service (systemd in WSL now, the same unit on the home server later). The web app ships as a built Nitro server started by the same CLI. Development mode still runs both with hot reload. The web app declares itself installable as a PWA so it can be launched from an icon on desktop and Android.

**The web app.** Nuxt 4 with Nuxt UI 4. Its Nitro server proxies every API call to the daemon, so the browser is always same-origin and the daemon is never exposed directly. The app shell is a dashboard layout with a sidebar, a header, and the project picker; the sidebar stays empty until Phase 2 fills it from the registry. Set up the Nuxt layer convention and the lint rules that keep layers from importing each other now, even though no capability layer exists yet, so Phase 2 only adds layers.

**Pluggable auth.** Requests reach the daemon through one auth middleware with swappable strategies. Ship three: a development strategy that signs everyone in as the admin, a password strategy with a server-side session cookie for day-to-day use behind Tailscale, and a trusted-header strategy for a future hosted proxy. The user and role tables exist from the start with one admin user and the admin role. Nothing else in the daemon ever reads a header or cookie; it reads the resolved actor.

**Projects and organisations.** A project is a registered codebase: a name, a stable slug, a colour, an optional organisation, and a source. The only source kind in v3 is a local path; the model must leave room for a managed clone later. The daemon verifies on save that the path exists and whether it has a `.beads` directory and a git remote, and shows both facts on the project. Organisations are plain groups: name and slug. The picker lists projects grouped by organisation, with ungrouped projects at the bottom, and organisations themselves cannot be selected. The selected project is part of the URL, so every page in later phases is linkable per project, and the last selection is remembered.

**Settings area.** A system group in the sidebar holds Projects (list, create, edit, archive, with organisations managed inline) and a placeholder Settings page. These are not capabilities; they are the platform's own pages, as Digital Hub's system group is.

## Human test

Install the daemon as a service with the CLI and confirm it survives a terminal close and a reboot. Open the web app, log in with the password strategy, install it as a PWA. Create two organisations and four projects, two pointing at real local repos with beads and one at a path with no `.beads`. Confirm the picker groups them, the beads and git facts show correctly, and switching projects changes the URL and persists across reload. Stop the daemon and confirm the web app shows a clear "daemon unreachable" state rather than a blank page.
