---
name: plan-decomposition-into-beads
description: "Decompose a plan into a graph of beads, each executed by one agent, with points, agent-fit, and a wide dependency graph. Use for task breakdown and work assignment. Assumes each bead follows the beads-writing skill."
---

# Decomposing a plan into beads

You are turning a whole plan into a graph of beads (work items). Each bead will later be
picked up by a _separate_ agent that sees only that bead's text — so decomposition is two
jobs at once: getting the **graph** right (structure, points, agent-fit, concurrency) and
making sure **every bead is self-contained** per the beads-writing skill. Do both; a
perfectly-shaped graph of spec-fragment beads still fails.

## Structure and points

- The whole plan becomes **one epic**; each phase becomes a **sub-epic** (set each bead's
  `phase` to its plan phase document). Simple plans omit phase.
- Break work down into logical parts. A single bead should be simple and focused.
- Each bead should have a **point value** (1–5) that reflects its complexity and the amount of work it represents. Use your judgement, but err on the side of smaller beads — a 1–2 point bead should be executable without any interpretation, while 3+ points may require some reasoning or judgement.

## Agent-fit

These beads will be picked up by subagents of the main agent.
Each bead should have a 'agent' label that describes the type of agent that can execute it. The label should be one of:

- `sonnet` - a junior agent, can execute simple, straightforward tasks with clear instructions
- `opus` - a mid-level agent, can execute tasks that require some reasoning or judgement
- `fable` - a senior agent, can execute complex tasks that require significant reasoning or judgement

**Lower-rung agents are trusted less**, so the smaller and more junior the bead, the more
explicit and closed-ended its description and acceptance criteria must be. A 1-pointer
for a low rung should be executable without any interpretation. Senior-rung beads state
outcomes, not steps.

State exceptions and hard requirements explicitly in the bead; don't add examples — the
agent won't need them.

## Concurrency

- **Make concurrency a priority:** the runtime will eventually run one agent per open bead,
  so keep the dependency graph **wide**. Only add a `dependsOn` edge for a real ordering
  constraint, never for tidiness. If bead B just needs to _know_ something bead A
  establishes, state that requirement in B's text instead of chaining them.

## The failure mode to avoid: transcribing the plan

When a plan is written as a spec — full of "must" clauses, type definitions, and file
trees — the tempting move is to slice those clauses into bead descriptions verbatim. Don't.
That produces beads that read as checklists with no _why_, and the worker can satisfy every
clause while missing the point.

Each bead must be **re-narrated from the plan's intent**, not lifted from its wording:
recover the problem the phase solves, state it in the bead, then the change, then the
non-goals. If the plan didn't give you a _why_ to recover (because it was written as a
spec), that's a signal the plan itself needs the plan-writing treatment first — flag it
rather than propagating spec-style beads.

**Lifted from a spec (avoid):** a bead whose description is
_"Instance identity must remain stable as scope, owner, and instance slug, serialize
canonically for URLs and persisted references… Global config and encrypted secrets must use
lazy global storage with existing atomic-write, permissions, encryption, and redaction
guarantees…"_ — a wall of demands with no problem statement.

**Re-narrated (do this):** _"Today a plugin can only belong to a project or organisation,
so installation-wide integrations have no honest owner. Add a real 'global' owner so such
instances stop being faked onto arbitrary projects. A global instance must stay identifiable
across renames and be safe to reference from URLs and persisted records; its secrets get the
same protection as existing scoped secrets and are only written when something is saved.
Existing project/organisation plugins keep loading unchanged."_ Same requirements, but a
worker understands what they're building.

Also watch for **bundled concerns**: a single spec milestone often hides two beads (e.g.
"identity model" and "global storage" are separate deliverables). Split them so each is one
concern, ~2–3 points, and independently testable — which also widens the graph.
