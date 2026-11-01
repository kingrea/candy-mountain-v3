# Phase 2: Candy Mountain consumes the release

**Capability:** Candy Mountain installs the platform from the registry at a pinned version, its own platform copies are gone, and a developer can point it at a local base checkout with one command to work on both at once.

## What and why

**Switching over.** Replace Candy Mountain's workspace copies of the platform packages with the published ones at the version phase 1 released. The capability packages and the thin apps change only their import sources. The boundary lint keeps enforcing that capabilities import the SDK and nothing deeper, now against installed packages. Delete the copies once everything is green; there must be one source of truth for the platform from this point.

**The development loop.** Working on the base and on Candy Mountain at the same time is the daily cost of separate repos. Provide one script that links a product to a local base checkout (pnpm overrides to the checkout's packages, with the base's build watching) and one that unlinks it back to the registry version, and document both in the base's conventions. The lock file must not carry the linked state into a commit; make that hard to do by accident.

**Upgrading.** Document the upgrade path a product follows when the base releases: bump the pinned version, read the changelog, run the pipeline. A breaking SDK major is expected to need capability changes, and the changelog says what.

## Human test

With Candy Mountain on the registry version, run the pipeline, start the apps and repeat the v3 plan's human tests for issues, chat, bots and uptime. Link to a local base checkout, change a visible string in the platform shell, see it in Candy Mountain without publishing, then unlink and confirm the lock file is unchanged. Publish a patch release of the base, bump Candy Mountain to it and confirm the pipeline is green.
