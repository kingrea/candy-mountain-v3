---
name: beads-writing
description: "How to write a single bead (work item) so an isolated agent can execute it with no other context. Use when drafting or reviewing task descriptions and acceptance criteria."
---

# Writing a bead

A bead is one unit of work. The agent that picks it up **gets nothing but the bead text** —
not the plan, not the chat it came from, not the other beads. So a bead lives or dies by
whether its description carries everything that agent needs to do the work correctly and
know when it's done.

## Rules

- **Self-contained.** The description must carry the goal, the _why_, the constraints, and
  any background from the discussion it needs. Never write "as discussed", "per the plan",
  or otherwise point at context the worker can't see.
- **Describe WHAT and WHY, never HOW.** No dictated file names or function
  signatures. The worker decides the implementation — that's the whole point of handing it
  a problem instead of a transcription.
- **Code blocks** shouldn't be used unless explicitly part of the work. A code block is a HOW, not a WHAT or WHY. Err on the side of not using them.
- **Titles** are short, action-oriented, and specific.
- **Acceptance criteria** state how to tell the bead is done, in observable terms — what a
  human or test can check, not "the code is correct".
- **State exceptions and hard requirements explicitly**, in prose. Don't add examples; the
  worker doesn't need them.

## What good and bad look like

A bead should open with the problem, then say what to build, then pin down defaults and
non-goals. A bead that opens with a stack of "must" clauses is a spec fragment, not a
task — the worker can satisfy every clause and still build the wrong thing, because nobody
told them what it's _for_.

**Weak — a list of demands, no what/why:**

> Make global ownership a first-class plugin scope without creating a fake project or
> organisation. Instance identity must remain stable as scope, owner, and instance slug,
> serialize canonically for URLs and persisted references, and survive display-label
> changes. Global plugin configuration and encrypted secrets must use lazy global storage
> with existing atomic-write, permissions, encryption, and redaction guarantees…

There's no _why this exists_, no picture of today's world, and no explicit non-goals — the
worker has to guess the intent behind every constraint.

**Strong — problem, then change, then defaults and non-goals:**

> Users need a manual way to mark a new bead as deserving a full planning session. Extend
> the Add bead flow in the UI with an option (a checkbox or toggle — exact control is the
> implementer's choice) that, when enabled, applies the `stage:planning` label at creation
> time. The default is unflagged: creating a bead without touching the option must behave
> exactly as today. `stage:planning` is a plain label following the existing `stage:*`
> convention — no new bead fields, no workflow behaviour. Do not add filtering or
> enforcement; this is purely a way to set the label at creation.
>
> _Acceptance:_ creating a bead with the option enabled produces a bead carrying
> `stage:planning`, visible in the backlog; without it, a bead identical to today's.

Note the shape: one sentence of _why_, concrete _what_, an explicit default that preserves
current behaviour, and clear non-goals. It names a UI control only as an illustrative
choice the worker is free to override — never as HOW.

The strong version does mention a specific label name (`stage:planning`) — that's fine,
because the label is a genuine cross-cutting requirement, not an implementation detail the
worker is free to change. That's the line: name the things the worker _must not_ choose
differently; leave everything else to them.
