# Phase 3: Web shell seam

**Capability:** The web shell is product-agnostic. It reads the product's name, colours and scope label from configuration, fills its extension points from the layers it is given, and builds with any subset of capability layers.

## What and why

**Product configuration in the shell.** The product name, the theme colour, the scope label and prefix, the manifest and icons for the PWA are read from one product configuration shared with the daemon's, not from constants and a hard-coded app config. The scope label flows into every string that says "project" in platform pages: the picker, the projects page, the modules and plugins setup pages, the gate's empty states.

**Capabilities contribute, the shell never knows them.** Three places in core today know specific capabilities or plugin types, and each becomes a contribution point:

- The plugin panels and forms for the Repository, Claude Code and Codex plugin types are registered from core's own Nuxt plugin. Move each panel and form into the layer of the capability that owns the plugin type, registered through the existing panel and form registration. The Plugins page stays platform and renders whatever was registered.
- The chat layer renders a bot worktree card and model and effort controls that belong to the ACP session families. Give the chat layer a contribution point for family-specific transcript and prompt-bar pieces, registered from the capability that owns the family, so the chat layer has nothing of Candy Mountain in it.
- The overview page shows facts, enabled modules, plugin health and activity. Facts and events already come from the registry after phase 2. If any card on the overview reaches into a product capability's data, it becomes a card the capability contributes to a named slot.

The settings and grants pages, the project picker, the navigation and the gate are platform and stay in core.

**An explicit layer list.** Today the web app globs its layers directory and the README forbids an extends list. Keep the glob for development inside this repo, and add the ability for a distribution to name its layers explicitly, because a distribution in another repo will install layers as packages. The boundary lint learns that a layer can be a package as well as a directory, with ownership still coming from where a file lives.

**The chat layer's home.** The chat layer is platform (the overview's line), so it moves with the shell in phase 4. Nothing in this phase moves it; this phase makes sure nothing product-specific is left inside it.

## Human test

Build and run the web app and walk every page: picker, projects, modules and plugins setup including the Claude Code login panel and the Repository panel, grants, settings, the overview, a chat with a Claude Code session showing model and effort controls, and a bot session showing its worktree. Change the product name and scope label in configuration and confirm the header, picker, setup pages and gate copy all follow. Then remove the uptime layer directory, run lint, typecheck and build, and confirm they pass and the app runs without it.
