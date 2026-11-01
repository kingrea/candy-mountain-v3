# Phase 5: Digital hub as a distribution (loose)

**Capability:** The digital hub runs as a distribution of the platform, with its capabilities ported one at a time, and the two products share one base instead of one being a fork of the other.

This phase is deliberately open. It gets its own plan when it starts; what follows is the shape and the decisions it will need.

## What and why

**The shape.** The hub is multi-scope, with clients as the scoping entity grouped by organisation, which the platform already supports. Its capabilities (investigator, uptime, audit, the hub agent) map directly onto the platform's capability, module and grant model because that is where the model came from. The hub becomes a product repo from the scaffold with a capability package per hub capability.

**What will need decisions.** The hub's chat streams through the AI SDK's message stream from a separate Mastra server, while the platform's chat is an SSE event log through the daemon. The hub's uptime is a static service list polled in process, while Candy Mountain's is per-workspace monitors in the database. The hub's permission gates tokenise personal data in tool output, which the platform does not do. Each of these is a choice between porting the hub's version, adopting the platform's, or lifting the hub's into the platform as a standard capability. The research notes in `.ai-docs/research/digital-hub.md` describe the hub's versions.

**Standard capabilities.** If the hub wants uptime and Slack connections, that is the moment to move them from Candy Mountain into the base repo as optional packages, versioned with the platform. The alternative is to copy them, which the requirements allow.

## Human test

To be written with the phase's plan. At minimum: the hub's existing human tests pass on the platform, and the three products run on the same base version.
