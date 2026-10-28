# Phase 5: Run issues with an agent

**Capability:** From an issue, or from a selection of issues, start a Claude Code or Codex chat that works on them.

## What and why

**Run buttons.** The issue detail and the bulk bar gain a working Run button. It is enabled only when the project has the Repository plugin configured and at least one of the Claude Code or Codex plugins healthy; otherwise it is disabled with a tooltip naming what is missing. If both agents are available, Run asks which one. It then opens a new chat thread for the project with the prompt Jack specified: "Complete <id>. Check to see if you have any skills relevant to running beads." With several issues selected the prompt lists every id. The platform does not orchestrate; the codebase's own skills decide how the agent works, and sub-agents are the agent's business.

**Create with an agent.** The "Create with Claude Code" and "Create with Codex" options in the Add Issue chooser open a thread seeded with a prompt that asks the agent to interview briefly and then create the issue with `bd`. Because the Issues page watches `.beads`, the new issue appears in the list as soon as the agent creates it.

**Activity.** Starting a run writes an event to the project's activity feed with the issue ids and a link to the thread.

**Working directory.** Runs started this way work in the project's checkout, which is what Jack wants for local, interactive work. Bots (Phase 6) are the ones that get worktrees.

## Human test

On a project with Repository and Claude Code configured, open an issue and press Run; confirm the thread opens with the exact prompt and the agent begins. Select three issues and press Run from the bulk bar; confirm all three ids are in the prompt. Remove the Repository plugin and confirm Run is disabled with the reason shown. Use "Create with Claude Code", answer its questions, and watch the new issue appear in the list without a refresh. Confirm the activity feed on the Overview page lists both runs.
