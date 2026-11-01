# Phase 1: Daemon registration seam

**Capability:** The daemon starts from a list of capability definitions and a product configuration, and removing an entry from the list removes that capability's routes and services without touching anything else.

## What and why

**The runtime half of a capability.** Today a capability's manifest declares views, tools, agents, jobs and requirements, and the daemon's app and platform modules then hand-wire the capability's routes and background services by name. Give each capability a single runtime definition that carries the manifest and everything the daemon needs to run it: the routes it mounts under a workspace and at the platform level, long-running services with a start and a close so shutdown order stays correct, the plugin types it brings, MCP servers it offers to agent sessions, chat families it runs, and any hooks it needs on workspace deletion. The daemon walks the list, validates it as it validates manifests now (a bad definition stops boot with a message naming the capability), and wires everything from it. The app and platform modules stop importing any capability.

Existing capabilities get their definitions written in place. Their code does not move in this phase; only the wiring changes. Services that several capabilities share today (the ACP harness, the worktree pool, the Slack connections, the agent MCP host) become services owned by one capability and offered to others through the definition, or stay platform if the platform list in the overview says so. Where a product capability needs another (bots need worktrees and ACP sessions), the dependency is declared in the definition so the daemon refuses a list that is missing a dependency, rather than failing at the first request.

**Open ids.** The shared package currently fixes capability ids, plugin type ids, agent session families and activity event types as closed lists. Replace them with the same validation at boot: an id must match the manifest id pattern, must be unique across the list, and must exist wherever it is referenced. Types stay strict where they can (a capability definition is still generic over its own view and tool ids) but the universe of ids is whatever the list says.

**Product configuration.** The product name, the scope label (Candy Mountain says "project"), the theme colour and the lists of capabilities, modules and plugin types become one product configuration object the daemon entry point builds and hands to the platform start. The daemon exposes the product's name and scope label on its info route so the web app can read them rather than import constants.

**The CLI** keeps working unchanged; it already runs the built daemon by path.

## Human test

Start the daemon and confirm the boot log lists the same capabilities, modules and plugin types as before, every page of the web app still works, and a bot run from Slack still completes. Then remove the uptime capability from the product's list and restart: the daemon boots, the uptime routes return not found, the sidebar has no Uptime entry, the Modules setup page shows the Operations module without uptime, and nothing else changed. Put it back. Finally, add a capability definition whose manifest references a plugin type the product does not include and confirm the daemon refuses to start with a message naming both.
