# Phase 0: the platform releases from `main` without waiting

Repository: `crab-shack/platform`. Depends on nothing.

The other half of phase 0, Candy Mountain moving to platform 0.5, is already tracked as beads 8by.4.12 to 8by.4.14 and has no document here.

## The fast lane

Releasing the platform today takes three waits. A push to `main` runs lint, typecheck, test and build before anything else happens. The release workflow then opens a "Version Packages" pull request that a person has to merge. Merging it runs every gate again and only then publishes. Jack is the only developer and the platform is in active development, so each wait is pure delay, and an agent cannot finish the loop at all because it cannot merge. Phases 1 and 5 of this plan each need a platform release.

While the fast lane is on:

- **A push to `main` is the release.** No pull request to open and no generated release pull request to merge. A change to a platform package states its version bump in the same push, and that version is published without a further human step.
- **Publishing does not wait for the checks.** Lint, typecheck and tests still run on every push and report, beside the publish. Only a build failure stops a publish.
- **Nobody has to pull a robot's commit before pushing again.** The pushed commit already holds the versions.
- **An agent can release.** The repository gains agent instructions giving agents standing permission to commit and push to `main` when a piece of work is finished.
- **Publishing from a laptop is the documented fallback** for when the workflow itself is broken.

What does not change: the five platform packages keep one shared version, every change still carries a changeset and lands in the changelogs, the same tags are pushed, and the packages are published the same way to the same registry.

## Turning the gate back on

One documented switch restores today's careful flow, with no rewrite of the workflows. The README and the contributing page describe both positions and say the repository now starts with the gate off. Enforcing pull requests on a private repository needs a paid GitHub plan the organisation does not have, so until then that half of the gate is a convention.

Phase 3 gives the capabilities repository the same lane. Build this one so it can be copied.

## Human test

Change a line of a platform package's README, state a patch bump and push to `main`. Without opening anything on GitHub, see all five packages at the new version on the organisation's packages page within a few minutes. Push again from the same clone without pulling. Break a test on purpose and push: the checks run red and the publish still happens. Flip the switch, push a change with a red test, and confirm nothing is published. Flip it back.
