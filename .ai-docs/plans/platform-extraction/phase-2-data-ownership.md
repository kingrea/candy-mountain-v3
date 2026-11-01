# Phase 2: Data ownership

**Capability:** The platform owns the workspace; each capability owns its own tables, migrations, workspace facts and activity event types; and a capability removed from the product leaves no routes, no services and no schema behind on a fresh database.

## What and why

**The workspace entity.** The project table today carries both what every product needs (identity, slug, name, colour, organisation, archived state) and what only Candy Mountain needs (the repository source and the verification facts about the path). Split it. The platform owns a workspace with the first set, plus module enablement and grants as now. Candy Mountain's repository source and verification move to product data keyed by workspace id and owned by the capability that needs them (the one that verifies paths and later clones). Platform code, the database and the API say workspace. The web app keeps calling it a project because the product configuration says so, and the `/p/` prefix stays. Organisations stay platform: they only group the picker, and the digital hub will want the same grouping for clients.

Deleting a workspace must still clean up everything that hangs off it. The platform fires the deletion through each capability's definition in reverse dependency order, which is where today's per-capability delete hooks move.

**Per-capability schema and migrations.** The daemon currently has one Drizzle schema and one migration folder for every table in the system. Give each capability its own schema and migration folder, applied at boot in dependency order, each tracked in its own migrations table so one package's history never renumbers another's. The platform's own tables (users, roles, sessions, workspaces, organisations, enablement, grants, plugin instances, platform meta, activity, chat threads) are the first set applied. A capability's foreign keys may point at platform tables, never at another capability's unless it declares that dependency.

Existing data on Jack's machine must survive: the current numbered migration history is replaced by per-package histories, and a database created by the old history must come out identical to one created by the new ones. Decide and document how an existing database is carried across (a one-off that records the new histories as applied is acceptable); nothing is deployed anywhere else.

**Facts and event types.** Workspace facts (has beads, is a git repo, has a remote, has bots) are computed today by platform code reaching into product tables. A capability declares the facts it provides and how to compute them; the registry asks the definitions. Activity event types likewise become declarations from the capability that emits them, with the feed and the notification rules reading the registered list. Platform facts (the LLM gateway is configured) stay platform.

## Human test

Delete the local database, start the daemon, and confirm every migration set applies in order and the boot log names each package's count. Create a project, enable modules, add a bot, run a monitor, and confirm the overview shows the same facts as before. Delete the project and confirm its bot, monitors, environments, plugin instances and activity are gone. Then start from the pre-phase database copy and confirm the daemon carries it across without data loss. Finally, remove the uptime capability from the product list, delete the database, start, and confirm no uptime table exists.
