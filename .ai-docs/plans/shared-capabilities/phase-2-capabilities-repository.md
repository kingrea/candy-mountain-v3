# Phase 2: the capabilities repository exists and runs on its own

Repository: `crab-shack/capabilities`. Depends on Candy Mountain being on platform 0.5 (phase 0a), so the packages arrive already stating their SDK major, and on Jack creating the repository and cloning it beside the platform checkout.

## The packages move with their history

The fourteen capability and connection packages, the Claude Code ACP shim and the shared test support move to the new repository with their git history, as the platform's packages did when they left Candy Mountain. They are renamed to the `@crab-shack` scope. Every place a package names itself or a sibling follows: the name each definition states, the way each package finds its own migrations on disk, the dependencies between them.

Nothing else about them changes. Capability ids, plugin type ids, layer ids, table names and migration histories are byte for byte what they were, because an existing database identifies a capability's migrations by its id and its history.

Candy Mountain is not touched in this phase. It keeps its own copies until phase 4, so for a while the source exists twice. Changes made to Candy Mountain's copies after the move have to be carried over by hand, so keep that window short and avoid capability work in Candy Mountain during it.

## The repository is a product

The repository has the same shape and the same four gates as the platform's: a workspace, the tooling presets from `@crab-shack/platform-config`, and a development distribution of a daemon and a web app with every capability enabled. That distribution is where a capability is run and tested, and its tests are the ones that today live in Candy Mountain's apps and exercise capabilities together. It consumes the published platform at a pinned version, like any product, and can link to a platform checkout.

The repository pins one platform version throughout, and its README says which.

## No capability names the product

A few capabilities write "Candy Mountain" into text a person or an agent reads: the bot instructions and the Slack notification link. Take the name from the product instead, so the same package reads correctly in any product. Environment variable names stay as they are; they are the platform's convention, not the product's.

## Documents

The README is the map of the repository: what each package is, which others it needs, how to run the distribution, and how to start a new shared capability here with `platform-new`. The agent instructions file says how work is tracked and, once phase 3 lands, how it is released.

## Human test

From a fresh clone: install, run the four gates green, and start the development distribution. Create a workspace, enable every module, and confirm the features work as they do in Candy Mountain: an issue is created, a chat thread starts on Claude Code and on Codex, a bot runs, an uptime check reports, the deployments page reads a live version. Search the packages for "Candy Mountain" and `@candy-mountain` and find nothing outside history and changelogs.
