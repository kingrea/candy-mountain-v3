# Phase 2: Capability framework

**Capability:** Modules and plugins can be set up per project, the sidebar and chat rail reflect what the selected project has, and a first real plugin (Repository) and a first real view (project Overview) prove the loop.

## What and why

**Capability manifests, one home.** Copy Digital Hub's manifest shape: a capability declares its views, agents, tools, jobs, required plugins and a monotonic rung ladder starting at `none`, validated at boot so a bad manifest stops the daemon. The difference from Digital Hub: the manifest is the only place a capability is declared. The daemon derives agent registration, tool gating, route mounting and the view list from it, and the web app derives routes from the manifest's view paths rather than a second hand-kept map. Adding a capability means one manifest plus one Nuxt layer whose name matches the capability id.

**Modules.** A module groups capabilities with a default rung each. A capability may sit in several modules. Three modules are declared now (Issues, Agent Hub, Operations) with their capabilities filled in by later phases; a module with no capabilities yet simply renders nothing.

**Grants per role, enablement per project.** Grants follow Digital Hub: a role is granted a module or a standalone capability at a rung, the admin role always resolves to the top rung, and the actor's rung is the maximum across their grants. New in v3 is the project axis: each project has its own set of enabled modules, and readiness is computed per project from that project's plugin instances. The registry endpoint therefore answers for an actor *and* a project, and returns the sidebar groups, the views, the agents the actor may chat with, each capability's rung and readiness, and the modules that are degraded and why. The sidebar, the chat rail, view gating and the setup pages all read this one answer.

**Plugins.** A plugin type is code: an id, a description, plain-language "reach" lines shown before enabling, the config fields and the secret fields it needs, its supported scopes (project or global), and a health check. Instances belong to a project or to the platform. Secret fields go to the encrypted store and are shown only as "set" afterwards. Because capabilities declare the plugins they require, a plugin configured for one capability serves every other capability in the project that needs it; nothing is configured twice. A capability whose required plugins are not healthy for the project is degraded, its views show a soft lockout explaining what to configure, and its module shows a warning in the sidebar.

**Setup pages.** Per project, a Modules page lists the three modules with their capabilities, lets the admin enable or disable each module, and shows the plugins each module needs with a configure link. A Plugins page lists instances for the project and the platform, with create, edit, test connection, and delete. A Grants page lists roles and their rungs; with one admin role it is mostly read-only, but it exists so the model is exercised.

**Repository plugin.** The first real plugin: one per project, GitHub or Bitbucket, holding the remote's owner and name and a scoped token as a secret. Health means the token can read the repository and list branches. Both the persona check in Phase 6 and the deployments work in Phase 9 depend on it. Include a small branch-list call so "test connection" shows real data.

**Overview capability.** The first real view, in the Issues module for now: a project home page that shows the project's facts (path, remote, beads present, enabled modules, plugin health) and an activity feed that is empty today. Later phases append events to this feed (sessions started, bots finished, incidents, deploys), so define the feed as a general event list with a type, a title, a timestamp and a link, written by the daemon.

**Layer rules.** Each capability's layer owns its pages, components and composables with the layer prefix, may import from core and from the shared chat layer, and may not import from another capability. Lint enforces this.

## Human test

For one project, open Modules, enable the Issues module, and see the Overview page appear in the sidebar. Open Plugins, add a GitHub Repository instance with a scoped token, run "test connection", and see branches listed. Enter a wrong token and confirm the instance shows unhealthy and nothing that depends on it pretends otherwise. Switch to a project with no modules enabled and confirm the sidebar is empty apart from the system group. Confirm a secret is never returned by any endpoint after being saved.
