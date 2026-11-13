# Shared capabilities: overview

## Goal

Candy Mountain's capabilities and connections leave this repository for `crab-shack/capabilities`, where each one is published as its own package. A product picks the ones it wants by depending on them, the way it already depends on the platform, and writes its own beside them. At the end, Candy Mountain holds no capability source, a second product uses some of the same capabilities at versions it chooses, and a fix made once reaches every product that takes the new version.

This plan follows `.ai-docs/plans/platform-package/` (the platform is published and Candy Mountain consumes it) and `.ai-docs/plans/connection-packages/` (every plugin type has its own package).

Why now: a second platform is about to start and needs several of these capabilities. Today the only way to get them is to copy the packages, and each capability owns tables and a migration history, so every copy would fork that history and every fix would have to be ported by hand.

## Explicit requirements

These are constraints from Jack, not choices to revisit.

- The capabilities live in one repository in the `crab-shack` organisation, checked out locally beside the platform in the `crab-shack` workspace.
- All fourteen capability and connection packages move. None stays in Candy Mountain.
- A product picks capabilities individually and can also write its own.
- While this is in active development, releasing must not wait on anything: no pull request to open, no release pull request to merge, no waiting for checks before a publish. The checks and the review step come back later, when the packages are in wider use, so they must be easy to turn back on.
- An agent working in the capabilities repository can release a change by itself.
- `crab-shack/platform` gets the same fast release lane, for the same reason.
- The order of work is the one in the phase table.

## Decisions

| Decision | Default | Why |
|---|---|---|
| Reference or copy | Products depend on published packages. Nothing is copied into a product. | Each capability owns its schema and migration history. A copy forks both. A product that wants a variant generates its own capability with `platform-new`. |
| Where they live | A separate repository, `crab-shack/capabilities`, not a folder of `crab-shack/platform`. | Capabilities change far more often than the platform, and the capabilities repository consuming the published platform exercises the same path every product uses. The cost is that a breaking platform change takes two steps (platform, then capabilities); linking softens it. |
| Names | `@crab-shack/cap-<id>` and `@crab-shack/plugin-<id>`. Every capability id, plugin type id, layer id and table name is unchanged. | Nothing stored in a database or a URL moves, so an existing Candy Mountain database keeps working. |
| What else moves | The Claude Code ACP shim and the shared test support. Both are published. | Capabilities depend on the first at runtime, and both capabilities' tests and a product's own tests use the second. |
| Versions | Each package has its own version. They do not share a version line as the platform's packages do. | A migration in one capability should not look like a release of the others, and a product should be able to take one fix without moving everything. |
| Dependencies between capabilities | Declared so that a product always holds exactly one copy of each capability, however many others need it. | Two copies of a capability mean two sets of service keys and two migration sets; the platform's dependency checks already assume one. |
| What the published package holds | The daemon half built, the web layer and the migrations as source. | This is what the platform's own packages do, and it lets a product's built daemon run with plain Node. |
| The repository is runnable | It carries a development distribution with every capability enabled. | Capabilities need somewhere to be run and tested that is not Candy Mountain. Candy Mountain plays that role today. |
| Product name in capabilities | Read from the product. No capability names Candy Mountain. | The same package runs in products with other names. |
| Release flow during development | A push to `main` publishes. Checks run on every push but beside the publish, not before it. One documented switch restores the gate. | See phase 3. Products pin exact versions, so a bad release reaches a product only when someone moves it to that version. |
| The platform's release flow | The same fast lane, built first (phase 0b) so the capabilities repository copies it. | Phases 1 and 5 each need platform releases, and the slow loop is Jack's main blocker today. |
| Where the work is tracked | In Candy Mountain's bead tracker, for all three repositories, as the platform's move was. | One graph shows what blocks what across repositories. The capabilities repository gets no tracker of its own in this plan. |

## Phases

| Phase | Capability | Depends on | Repository |
|---|---|---|---|
| 0a | Candy Mountain on platform 0.5: every capability states its SDK major. Already tracked as beads 8by.4.12 to 8by.4.14; no phase document. | none | Candy Mountain |
| [0b](phase-0-platform-fast-lane.md) | The platform releases from `main` without waiting. | none | platform |
| [1](phase-1-installed-capabilities.md) | The platform treats an installed capability like a local one, and a product can link to a capabilities checkout. | 0b | platform |
| [2](phase-2-capabilities-repository.md) | The capabilities repository exists and runs on its own. | 0a | capabilities |
| [3](phase-3-publishing.md) | Capabilities are published, with the fast lane. | 2, 0b | capabilities |
| [4](phase-4-candy-mountain-consumes.md) | Candy Mountain runs on the published capabilities and holds no capability source. | 1, 3 | Candy Mountain |
| [5](phase-5-adding-a-capability.md) | One command adds a capability to a product, and a catalogue lists what exists. | 1, 3 | platform, capabilities |

Phases 0a and 0b can run at the same time, as can 1 and 2, and 4 and 5.

The new platform is not a phase here. It can start as soon as phase 3 has published the capabilities it needs, adding them by hand as the platform's capability guide describes, and it is the second proof after Candy Mountain.

## Human test

On a machine with an existing Candy Mountain database: Candy Mountain has no `cap-*` or `plugin-*` folder, starts on that database without applying a migration, and every feature works as before. Change a label in one capability in the capabilities checkout, see it in Candy Mountain through a link without publishing, then push it and see the new version in the registry a few minutes later without opening a pull request. In a freshly generated product, add one capability with one command and see its page in the running app.
