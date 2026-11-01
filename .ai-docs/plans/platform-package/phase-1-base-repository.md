# Phase 1: The base repository

**Capability:** The platform lives in its own repository, builds and tests on its own, runs with only the template capability, and publishes versioned packages to the private registry.

## What and why

**The move.** Create the base repository and bring the platform packages across with their history: the daemon platform, the web platform layer, the SDK, the platform config, the CLI, the test kit, the template capability and the conventions documents. Rename them under the chosen scope. Candy Mountain's repo keeps its capability packages and thin apps and, for now, its copies of the platform packages, so it stays green until phase 2 switches it over.

**Runnable on its own.** The base needs a development distribution of its own: a daemon entry and a web app that assemble the platform with the template capability and nothing else, under a placeholder product name. This is what the base's tests run against, what a contributor opens to see a change, and the proof that the platform does not secretly depend on a Candy Mountain capability.

**Release.** Changesets manages versions and changelogs. A release workflow builds, tests and publishes every platform package at one version to GitHub Packages, private to the organisation. Each package ships built output with type declarations, because consumers must not need the base's toolchain to install it. Decide what the web platform layer publishes: a Nuxt layer can ship as source and be compiled by the consumer's Nuxt, which is the normal practice, so the web package likely publishes source while the daemon packages publish built output.

**Access.** Document how a developer and a CI job authenticate to the registry with a read-only token, and how a client repo would do the same for only the packages it needs.

## Human test

Clone the base repository fresh on a machine with no Candy Mountain checkout, authenticate to the registry, install, run the pipeline, start the development distribution and see the template capability's page, table, event and overview card working. Cut a release with a changeset and confirm the packages appear in the organisation's registry at the same version, private, with types.
