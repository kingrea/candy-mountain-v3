# Phase 4: Candy Mountain runs on the published capabilities

Repository: Candy Mountain. Depends on phases 1 and 3.

## Candy Mountain becomes a thin product

Candy Mountain depends on the published capabilities at exact versions and deletes its own copies, together with its copies of the ACP shim and the test support. What remains is the product: its description, its apps, its brand assets and the tests that are about Candy Mountain as a product rather than about a capability. Tests that exercise capabilities together moved to the capabilities repository in phase 2; do not keep a second copy here.

Before deleting, confirm that nothing changed in Candy Mountain's copies since the move that the capabilities repository lacks.

The checks from phase 1 replace the ones that walked the workspace, so a capability that is installed but not listed, or listed but not installed, still names itself.

## Existing data keeps working

A Candy Mountain database created before this phase starts on the new build without applying any migration and without losing anything: plugin instances, logins, threads, bots, uptime history. This is the reason ids and migration histories were frozen in phase 2, and it is the thing to prove here.

## Upgrading is one edit per capability

Taking a new version of a capability is changing its version where Candy Mountain lists it and installing. The README says so, says how to see what is available, and says how to link to the local capabilities checkout to try a change first. Candy Mountain's CI token already reads the organisation's packages; confirm it reads the new ones.

## Human test

On a machine with a database from before this phase: confirm the repository has no `cap-*` or `plugin-*` folder, then start Candy Mountain. The daemon's boot log shows no migration applied. Every existing plugin instance is healthy, a chat thread starts on each family, a bot runs, uptime and deployments read as before. Link to the capabilities checkout, change a label there and see it in Candy Mountain, then unlink and confirm `git status` is clean. Publish that change, move Candy Mountain to the new version of that one capability, and see the label in a build.
