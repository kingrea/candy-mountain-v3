# Phase 6: Bots and team, with worktree isolation

**Capability:** I can define a bot for a project, point it at a persona in the repo, choose its agent and write scope, list who may talk to it, and run it in an isolated worktree from the chat panel before Slack is connected.

## What and why

**Worktree pool.** Lift Clanker's model: the project's checkout is the clone, and every bot session gets its own git worktree on its own branch under the daemon's data directory, cut from the bot's base branch. Leases are persisted so a resumed session lands in the same path, caps limit concurrent worktrees, idle worktrees are reclaimed only when they hold no unpushed or uncommitted work, and startup reconciles orphans. Dependencies are installed into the worktree when possible and the agent is told when they are not. Keep the main checkout out of bounds for bots and serialise git operations on it.

**Beads from a worktree.** Issue reads and writes by a bot must resolve to the project's main checkout beads database, not a copy inside the worktree. Jack keeps beads on Dolt and expects them to span branches. Find the mechanism `bd` offers for pointing at another database and apply it in the bot session's environment; verify it with `bd create` from inside a worktree landing in the main list.

**Bot definition.** One table, one row per bot, scoped to a project. Fields: name, the two Slack keys (bot token and app-level token, both secrets), agent family (Claude Code or Codex), write scope (read-only, write with confirmation prompts, write automatically), base branch (defaulting to the Repository plugin's default branch), and "answers in" as either anywhere or a list of channel ids entered one per input with an add button. No approvals section, no keyword, no Slack team id. The Bots page requires the Repository plugin and at least one of the agent plugins; a bot's family may only be chosen if its plugin is healthy. Persona is a name; a "check persona" action fetches the base branch and reports whether `.claude/agents/<name>.md` and `.agents/<name>.md` exist, and disables the family whose file is missing. Each bot card shows a status: active, not configured, or warnings with the reasons (plugin unhealthy, persona missing, Slack keys missing). Clanker's posture rules carry over: write scope maps to agent flags per family, the persona may not widen the posture, hooks in the checkout are disabled, blanket-bypass settings are refused, pushes always ask.

**Surface instructions.** When a bot session starts, the daemon appends its own instructions after the persona: the branch it is on and the branch to propose against, how to deliver (push and open a pull request through the Repository plugin's host), that `bd` works and where issues go, and the structured handoff format from Phase 7. This is the seam that keeps personality in the repo and platform behaviour in the platform.

**Team.** A per-project roster of people allowed to talk to the project's bots: name, email, Slack member id, and which bots (all or a list). No per-person agent login: sessions run under the project's plugin login. The Team page requires at least one bot.

**Console run.** Each configured bot appears as an agent in the chat rail. Starting a thread with it runs the real bot path: worktree lease, persona, posture, surface instructions, decisions in the panel. This is how a bot is tested before its Slack keys are used, and it is how Jack can drive a bot locally.

## Human test

Create a bot on a project whose repo has a `.claude/agents/<name>.md` but no `.agents/<name>.md`; run the persona check and confirm Codex is disabled with the reason. Save with Claude Code, scope "write with confirmation", base branch `main`. Add yourself to the team. From the chat rail, start a thread with the bot and ask it to fix a trivial issue by id. Confirm a worktree appears under the data directory on a new branch, that an edit prompts for confirmation, that `bd close` from the bot shows on the Issues page, that `git status` in the main checkout is untouched, and that a push asks first. Close the thread and confirm the worktree is reclaimed only after the work is pushed.
