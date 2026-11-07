# Connection packages: overview

## Goal

Plugin types stop living inside feature capabilities. Every plugin type is brought by a connection package named `@candy-mountain/plugin-<id>`, a service-only capability definition that feature capabilities require and depend on. At the end, two independently written capabilities that both need Codex require the same `plugin-codex` package instead of each defining a `codex` type and colliding at boot, and nothing depends on a chat UI capability in order to run an agent.

This plan sits between `.ai-docs/plans/platform-extraction/` (landed: the repo is platform packages, capability packages and thin apps) and `.ai-docs/plans/platform-package/` (next: the platform moves to its own repo and is published). It is a refactor inside this repo with no behaviour change.

Why now: the extraction left three feature capabilities bringing plugin types (chat-claude-code brings claude-code, chat-codex brings codex, deployments brings netlify and heroku) and the ACP session runtime inside chat-claude-code, so chat-codex and bots depend on a chat page to run agents. That was harmless in one repo. Once capabilities are published and written by other people, the only way to share a connection is to own the package that brings it, and the owner must not be a feature.

## Explicit requirements

These are constraints from Jack, not choices to revisit.

- Connection packages are capability definitions under the existing contract. No fourth package kind, no new SDK contract, no new product-file section.
- Connection packages are named `plugin-<id>` so a reader of the package list can tell a connection from a feature.
- Working pieces move as they are. No redesign and no behaviour change; every workspace's existing plugin instances, logins and sessions keep working.
- Candy Mountain stays green at the end of every bead: lint, typecheck, test, build.

## Decisions

| Decision | Default | Why |
|---|---|---|
| What a connection package is | A service-only capability definition (no manifest) whose id equals the id of the plugin type it brings. It may provide services, declare schema, mount routes and declare facts, as `repository` does today. It has a web layer when the plugin type needs UI (icon, form, panel). | The capability contract already carries everything a connection needs. A separate kind would duplicate the generator, the lint, the SDK check and the product-file handling for the same mechanism. |
| The rule | A definition with a manifest never declares plugin types; a `plugin-*` package's definition has no manifest and declares at least one plugin type; a `cap-*` package's definition declares none. Refused at boot by the definition helper and by the `cm-packages` lint. | This is the rule that prevents the collision. Boot refusal keeps a published package honest; lint keeps a local one honest before it ships. |
| Service-only packages that bring no plugin type | Keep the `cap-` prefix. The ACP runtime becomes `cap-acp`. | `plugin-acp` would claim a connection that does not exist. One exception is cheaper than a third prefix. |
| Where the ACP runtime goes | `cap-acp` (id `acp`): the harness, session manager, decisions, session and decision routes, and the `ACP_*` service keys. Depends on `threads` and `repository`. `plugin-claude-code` and `plugin-codex` depend on it and register their launchers; the chat capabilities and bots depend on it for sessions. | The launchers register on the session manager, so the manager must sit below both connection packages. Leaving it in chat-claude-code would make plugin-codex depend on a chat page. It is not platform because the home dashboard runs no ACP agent. |
| Where provider clients go | The Heroku and Netlify API clients and operations go with their plugin types into `plugin-heroku` and `plugin-netlify`. The live-version sources, which are a deployments concept, stay in `cap-deployments`, which depends on both connection packages and imports their clients. | A connection knows how to talk to the service. What to read from it for a deploy is the feature's business. |
| Session families | Declared by the connection package that owns the launcher. | The family and the launcher are one thing; the chat capability only renders it. |
| Web layers | A connection package with UI is a layer package like any other, with a layer id of the worker's choosing listed in the product configuration. The chat family pieces (prompt bar, options) stay in the chat capability's layer. | The README already says a plugin type's UI lives in the layer of the package that brings it. |
| Existing layer and plugin type ids | Unchanged. Capability ids `repository` and `slack` are unchanged by the renames. | Nothing stored in a database or a URL moves. |

## Order

1. The lint recognises `plugin-*` packages as capability packages (free).
2. Rename cap-repository and cap-slack (after 1).
3. Extract cap-acp (after 2) and split deployments into plugin-heroku and plugin-netlify (after 2); these run alongside each other.
4. Split plugin-claude-code and plugin-codex out of the chat capabilities (after cap-acp); these run alongside each other.
5. Enforce the rule at boot and in lint (after every split).
6. Conventions documents and the platform-package plan say the new shape (after 5).

## Human test

Start the daemon and the web app on a database that already has a Codex, Claude Code, Slack, repository and Heroku or Netlify instance. Confirm every instance still shows healthy on the plugins page with its icon, that the Claude Code and Codex login panels open and report the existing login, that a chat thread starts on each family, that a bot runs, and that the deployments page still reads a live version. In the daemon package list, confirm every package that brings a plugin type is named `plugin-*`, then add a manifest to one of them and confirm the daemon refuses to start naming it, and lint fails naming it.
