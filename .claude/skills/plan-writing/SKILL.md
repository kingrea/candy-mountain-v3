---
name: plan-writing
description: "Author a software plan as a what/why capability document (not a spec), so it decomposes cleanly into self-contained work items. Use when writing, restructuring, or reviewing a plan before breaking it into tasks."
---

# Writing a plan

A plan is the input to decomposition. Its readers are (1) the person approving the
direction and (2) the agent that will later break it into work items. Neither reader
should have to reverse-engineer your intent. A plan states **what** capability gets built
and **why**, at the level a capable engineer needs to make good local choices — it is not
a specification that dictates the implementation.

The single most common failure is writing a *spec* instead of a *plan*: types, file
trees, function signatures, exact commands. That feels rigorous, but it strips out the
reasoning, and anything downstream (a reviewer, a decomposer, a worker) then has only
demands to copy, not a problem to solve. See the worked example at the bottom.

## Layout

- A **simple plan** (one capability, no sequencing) is a single `plan` document.
- Anything with ordered capabilities is **phased**: an `overview` document plus one
  `phase-<n>-<slug>` document per phase. Convert simple → phased when real sequencing
  emerges, not before.
- The **overview** carries: the goal, explicit requirements, decisions made (with the
  chosen default and why), and a phase table with dependencies. Phase documents carry
  everything else.

## Phases

- Each phase is a self-contained **capability** (e.g. "Auth0 integration with a test
  page", "Slack integration", "gallery component for the PDP") — never a horizontal slice
  like "write the models" or "update the backend". A capability can be demonstrated; a
  horizontal slice cannot.
- Order phases **foundational-first**: backend and system work early, moving toward the
  frontend.
- **Every phase ends with a human tester in mind.** Backend-only phases must include a
  test page, an example page, or explicit manual-test instructions. State the human test
  at the end of each phase and make verification as easy as possible.
- Structure phases so independent ones can run concurrently; say which phases depend on
  which.

## Content

- **Explicit requirements the user gave** (e.g. "use VueFlow for the quest builder",
  "PrimeVue components") go early in the overview, labelled as requirements. These are the
  one place specificity belongs — they are constraints, not your choices to make.
- **State the what and the why at capability level, never implementation detail:** no
  variable names, no code blocks, no file layouts, no prescribing choices that are
  subjective. Trust the agent doing the work to pick well with the context it has. Every
  time you write a type definition or a directory tree, ask whether it is a genuine
  requirement or just you doing the worker's job — if it's the latter, cut it and state
  the constraint in prose instead.
- **New UI starts bare-bones:** functionality over looks. Prefer low-level headless
  component libraries (reka-ui, Radix, and similar) at their default appearance until
  asked to style.
- **Write concisely in plain language.** Shorter and clearer beats exhaustive; if a
  sentence doesn't change what gets built, cut it.

## Worked example — spec vs plan

The same phase, written two ways.

**Too rigid (a spec — avoid):**

> Introduce `type ScopeRef = { kind: "global" } | { kind: "organisation"; slug: string }
> | { kind: "project"; slug: string }` and `type PluginInstanceRef = { scope: ScopeRef;
> owner: string; instanceSlug: string }`. Add `CM_GLOBAL_DIR` defaulting to
> `~/.candy-mountain/global/` containing `plugins.json` and `secrets.enc.json`. Instance
> identity must serialize canonically. Global config must use lazy storage with
> atomic-write, permissions, encryption, and redaction guarantees…

Every reader now has demands to satisfy but no idea *why* any of them exist, and the
worker's design decisions have been pre-made for them — badly, since the plan author had
less context than the worker will.

**As a plan (do this):**

> **Global plugin ownership.** Today a plugin instance can only belong to a project or an
> organisation, so installation-wide integrations have no honest owner and get faked onto
> some arbitrary project. Give plugins a real "global" owner alongside project and
> organisation. A global instance must be identified stably enough to survive renames and
> to be referenced from URLs and persisted records. Its config and encrypted secrets live
> in global storage that follows the same safety guarantees as existing scoped storage,
> and is only created when something is actually saved. Existing project/organisation
> plugins keep working untouched.
>
> *Human test:* create a global plugin instance in the UI, save a secret, confirm it
> appears only in global storage and that an existing project plugin still loads.

Same requirements, but the *why* is intact, the worker keeps its design latitude, and it
decomposes into a bead that reads like a task, not a checklist.

## Note when porting these rules elsewhere

In the system these rules came from, plan validity (folder layout, phase docs) is enforced
in code, and the planner also has a knowledge base of past decisions and a live agent
roster to ground its choices. If you are following this skill without that surrounding
system, you are the enforcement: check your own layout, and don't invent decisions the
user should make — surface genuine forks to them instead.
