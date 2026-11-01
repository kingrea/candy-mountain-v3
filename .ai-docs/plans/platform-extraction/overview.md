# Platform extraction: overview

## Goal

Candy Mountain v3 becomes the first product built on a reusable platform base, without leaving its repository. At the end of this plan the repo has a clear line between platform (daemon core, web shell, SDK) and product (Candy Mountain's capabilities and plugin types). Every capability is a workspace package that reaches the platform only through the SDK, and the two apps are thin distributions that list what they include. Nothing is published. The follow-on plan in `.ai-docs/plans/platform-package/` moves the platform packages into their own repository and adds the second and third products.

Why now: the same shell (auth, secrets, plugins, capabilities, modules, grants, chat, layers) has been built three times, in Digital Hub, Candy Mountain v2 and v3. The digital hub and a home dashboard are next. Extracting the base from the most complete implementation while it still builds and runs is cheaper and safer than designing a base in an empty repo and porting three products onto it.

## Explicit requirements

These are constraints from Jack, not choices to revisit.

- The extraction happens inside this repository first. The base moves out only once Candy Mountain consumes it as packages (the follow-on plan).
- Turborepo on top of the existing pnpm workspace.
- Capabilities become workspace packages. They are not published anywhere.
- Platform pieces that work today (plugin types and instances, the secrets store, wrapped MCP tools, grants and rungs, ACP sessions) move as they are. No redesign during the move.
- The scope entity stays in the data model for every product. Single-scope products hide it in the UI. Building single-scope mode itself belongs to the follow-on plan, when the first such product exists.
- Candy Mountain keeps working at the end of every phase: lint, typecheck, test and build green, and the v3 plan's human tests still pass.
- The existing boundary rules (no capability-to-capability imports, prefixed auto-imports, pages under the capability's own path) stay, re-pointed at the package boundary.

## Decisions

| Decision | Default | Why |
|---|---|---|
| Where the line falls | **Platform:** data directory, database and migration runner, secrets, auth, workspaces and organisations, the capability, module and plugin type registries, module enablement, grants, registry computation, platform settings, activity feed, notification dispatcher, chat threads with native agent families, Mastra wiring and the platform agent, the agent MCP host, the web shell (layout, picker, gate, setup pages, plugins and grants pages), the CLI. **Product:** issues, ACP sessions and the Claude Code and Codex plugin types, worktrees, bots, bot sessions, team, Slack routing, decisions and handoffs, uptime, environments and deployments with the Netlify and Heroku plugin types, the Repository plugin type, assignees. | Platform is what every product needs. A home dashboard would use all of the first list and none of the second. Slack connections and uptime may later ship as standard capabilities from the base repo; that is a packaging choice in the follow-on plan, not a different line in code. |
| How a capability attaches to the daemon | A runtime definition beside the manifest: the manifest plus routes, long-running services with start and close, schema and migrations, plugin types, MCP servers, chat families, workspace facts and activity event types. The daemon receives a list of these at start and never imports a capability. | Today the daemon's app and platform modules hand-wire every capability's routes and services, and the manifest declares only views, tools, agents and requirements. The runtime half is the missing part of the contract. |
| Open ids | Capability ids, plugin type ids, session families, activity event types and fact ids become validated strings registered at boot, not closed unions in the shared package. | A closed union means adding a capability edits the base. Boot-time validation keeps a typo fatal, which is the property the unions were giving. |
| The scope entity | The platform owns a workspace: id, slug, name, colour, organisation, archived state, module enablement and grants. Candy Mountain adds the repository source and its verification as product data keyed by workspace. Platform code, tables and API say workspace. The label shown to users and the `/p/` URL prefix are product configuration. | A project is a workspace with a repository attached. The rename is mechanical now, with nothing deployed beyond Jack's machine, and painful later. |
| Schema and migrations | Each package owns its Drizzle schema and its migration folder. The daemon applies them at boot in dependency order, each under its own migrations table. | Migrations have to travel with the capability or the package is not a real unit. Drizzle's migrator takes a folder and a table per call, so no custom runner is needed. |
| Products are configuration | One product configuration object (name, theme colour, scope label and URL prefix, the capabilities, modules, plugin types and layers included) read by both apps. | The product name and the pink primary colour are the only product-specific values in core today. Making them one object means the second product is a config, not a fork. |
| Chat family coupling | The chat layer and the thread service stay platform. Family-specific transcript pieces (the bot worktree card, model and effort controls) register through a contribution point from the capability that owns the family. | Chat is Digital Hub's shape and the home dashboard wants it with a native agent. The ACP-specific parts are Candy Mountain's. |
| Package layout | `packages/platform-daemon`, `packages/platform-web` (a Nuxt layer package holding the shell), `packages/platform-sdk` (shared types, define helpers, the test kit), `packages/platform-config`. One `packages/cap-<id>` per capability with a daemon entry and a web entry. `apps/daemon` and `apps/web` become thin distributions. | Mirrors Backstage. One package per capability holding both halves keeps a capability a single unit to copy, extract or delete. |
| Discovery | Explicit lists in the distribution. No scanning of installed packages. | A missing entry in a list is a one-line diff to find. A scan that skipped a package is an afternoon. |

## Phases

| # | Phase | Depends on | Can run alongside |
|---|---|---|---|
| 1 | Daemon registration seam: runtime capability definitions, open ids, product config | — | 3 |
| 2 | Data ownership: the workspace entity, per-capability schema and migrations, facts and event types | 1 | 3 |
| 3 | Web shell seam: product config in the shell, contribution points, explicit layer list | — | 1, 2 |
| 4 | Packages and distributions: platform packages, capability packages, thin apps, Turborepo, boundary lint at the package line | 1, 2, 3 | — |
| 5 | SDK test kit and template capability | 4 | — |

Each phase document ends with its human test. Decompose phases with the `plan-decomposition-into-beads` skill one at a time, in order. Phases 1 and 3 touch different apps and can be decomposed together.
