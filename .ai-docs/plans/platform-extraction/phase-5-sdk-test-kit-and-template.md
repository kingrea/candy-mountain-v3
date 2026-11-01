# Phase 5: SDK test kit and template capability

**Capability:** A new capability can be written, tested and run against the platform from its own package alone, following a template that is itself a working capability in the repo.

## What and why

**The test kit.** Capability tests today lean on the daemon's fixtures: a platform started in a temporary data directory, a seeded admin, fake plugin instances, a fixture layered app for lint. Move what a capability needs into the SDK's test entry point: start a platform with only the SDK's platform packages and the capability under test, an actor at a chosen rung, a workspace with chosen facts, a plugin instance with fake secrets, and for the web a way to mount a layer page inside the gate with a registry that grants or denies the view. A capability's tests must not import the daemon or web apps.

**The template capability.** Add one deliberately small capability package to the workspace that exercises every contribution point: a manifest with one view and one operation, a route under the workspace, a long-running service with start and close, one table with one migration, a workspace fact, an activity event type, a layer page behind the gate, and a card contributed to the overview. It is included in the Candy Mountain distribution only in development so it can be seen running, and it is the thing to copy when starting a client capability. Its README is the capability author's guide: the contract, the rules, and the commands to run.

**Documenting the line.** The layers README becomes the platform's web conventions document in the web platform package. A matching daemon conventions document explains the runtime definition, service lifecycle, schema ownership and the dependency declaration. Both live where a capability author in another repo will find them when the follow-on plan ships packages.

## Human test

Copy the template capability to a new package name, change its id and label, add it to both apps, and confirm it appears in the sidebar under a module, its page renders behind the gate, its table exists, its event appears in the activity feed and its card on the overview. Run the new package's tests on their own with the test kit and confirm they pass without the apps present. Then remove it and confirm the pipeline is green.
