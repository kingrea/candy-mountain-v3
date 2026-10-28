# Candy Mountain v3: overview

## Goal

Candy Mountain is Jack's personal codebase-management platform. It runs as a long-lived local daemon plus a web app, holds a registry of codebases ("projects"), and for the selected project exposes modules built from small, isolated capabilities: an Issues viewer over beads, an Agent Hub that runs Claude Code and Codex bots from Slack, and an Operations module for uptime and deployments. Every capability is scoped to the selected project, and every agent is scoped to the tools and wrapped MCP servers it has been granted.

v3 is a fresh start that folds together the parts of three earlier codebases that proved themselves: Digital Hub's capability/module/grant architecture and agent chat panel, Clanker Corner's Slack bots over ACP with worktree isolation, and Candy Mountain v2's beads viewer. Research notes on each live in `.ai-docs/research/`. Read them before decomposing a phase; they say what to lift and what to avoid.

## Explicit requirements

These are constraints from Jack, not choices to revisit.

- pnpm monorepo. Web app on Nuxt 4 with Nuxt UI 4 and Tailwind. Capabilities are Nuxt layers, following Digital Hub's layer conventions and lint-enforced boundaries.
- The daemon is a Hono app Jack owns. Mastra is wired in as a library from the start so native LLM agents can be added later, but no native agent is built in v3 and no LLM gateway key is needed until one is. If a "platform chat" agent is planned, note that Jack adds the key and defines the agent later.
- Claude Code and Codex are driven over ACP using the ACP SDK directly, lifting Clanker Corner's Claude shim. No Anthropic or OpenAI API keys; the stock CLIs and their own logins only.
- The Claude Code plugin and the Codex plugin are configured per project. Different projects may use different accounts.
- Beads is the only store for issues. The platform shells out to `bd --json` and keeps no shadow copy of issue data. The UI says "issue", never "bead".
- Issues created or updated by bots land in the project's main checkout beads database, never in a worktree's own copy.
- "Run" on an issue opens a single Claude Code or Codex chat for the project with the prompt "Complete <id>. Check to see if you have any skills relevant to running beads." With several issues selected, the prompt lists them all. Orchestration is the codebase's own concern.
- Agent persona files are `.claude/agents/<name>.md` for Claude Code and `.agents/<name>.md` for Codex, on the bot's base branch.
- Organisations exist only to group projects in the picker. They cannot be selected.
- Auth is a pluggable middleware. One platform user (admin) for now; the schema carries roles so more can come later. Slack team members are not platform users.
- Digests, organisation-level issues, natural-language issue creation, docker sandboxes, and the v2 game skin are out of v3.
- Deployments stay deliberately open-ended. Vendors in scope: Netlify, Heroku, GitHub, Bitbucket.

## Decisions

| Decision | Default | Why |
|---|---|---|
| Process shape | Two processes: a daemon and a Nuxt app whose Nitro proxies to it, same-origin | Everything needs a persistent process with OS access. Same-origin avoids Digital Hub's cross-origin spoofable header. Editing the UI must not restart the daemon and kill live sessions. |
| "Desktop app" | Daemon installed as a user service with a small CLI; UI installable as a PWA; a Tauri shell is a later optional add-on | Gives launch-from-icon on desktop and Android with no packaging work, and keeps the home-server and Tailscale future intact. Electron would push the server into the window. |
| Platform storage | One SQLite database through Drizzle with migrations | All three predecessors used raw SQL with no migrations, and v2 also scattered JSON files. One schema, one migration path. |
| Secrets | v2's AES-GCM encrypted secrets store, write-only API | Proven; never returns values; survives a move to the home server. |
| Capability definition | Server-side manifest is the single home; the daemon registers agents, tools, routes, views and required plugins from it | Digital Hub needed eight hand-maintained lists per capability. |
| Registry | Computed per actor and per project | Module enablement and plugin instances belong to a project; grants belong to a role; readiness is per project. |
| Project source | `local-path` now; `managed-clone` (daemon clones using the Repository plugin) later | The Issues page must read the checkout Jack edits. Bots must never run there, so they get worktrees cut from that clone. Managed clones matter only once the daemon lives on a server with no human checkout. |
| Bot isolation | One clone per project, one git worktree per bot session, leases and safe reclaim (Clanker's pool) | Proven in Clanker; resume lands in the same path so both CLIs find their conversation. |
| Slack transport | Socket Mode, outbound, keys held in the secrets store | No public URL needed, so fully local works. New code relative to Clanker, which kept keys at the exe.dev edge. |
| Structured handoff | The platform appends surface instructions at launch asking for a fenced handoff block, parses it, and renders Block Kit itself | Consistent cards without trusting the model to write Block Kit. Persona files keep personality and task knowledge. A scoped Slack MCP tool lets agents post blocks directly as a follow-on. |
| Chat | Shared chat layer with a rail and panel on every page, threads and event logs persisted server-side, SSE replay | Digital Hub's chat shape, with Clanker's durable event log so a reload or restart does not lose a transcript (v2's biggest chat gap). |
| Issue data path | Dedicated REST per project with a short-lived cache and a watcher on `.beads` | v2 spawned a `bd` process per click through a generic tool-execute route and had no live refresh. |

## Phases

| # | Phase | Depends on | Can run alongside |
|---|---|---|---|
| 1 | Platform shell: daemon, web app, auth, projects and picker | — | — |
| 2 | Capability framework: modules, grants, plugins, per-project setup pages | 1 | — |
| 3 | Issues module | 2 | 4, 8 |
| 4 | Agent sessions and chat panel (Claude Code and Codex plugins) | 2 | 3, 8 |
| 5 | Run issues with an agent | 3, 4 | 6, 8 |
| 6 | Bots and team, with worktree isolation and a console test run | 2, 4 | 5, 8 |
| 7 | Slack surface: routing, streaming, decisions, structured handoff | 6 | 8, 9 |
| 8 | Operations: uptime | 2 | 3, 4, 5, 6, 7, 9 |
| 9 | Operations: deployments (loose) | 2 | 7, 8 |
| 10 | Platform extras: activity feed, notifications, platform chat agent | 7, 8 | — |

Each phase document ends with its human test. Decompose phases with the `plan-decomposition-into-beads` skill one at a time, in order.
