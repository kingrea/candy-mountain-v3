# Phase 7: Slack surface

**Capability:** Team members mention a bot in Slack and it works the request in its worktree, streams progress into the thread, asks for decisions with buttons, and ends with a structured handoff card.

## What and why

**Connection.** One Socket Mode connection per active bot, using the bot's stored keys, reconnecting on failure and reporting connection state on the bot card. No inbound HTTP, so this works with no public URL. The daemon refuses to start a bot whose keys are missing and reports it rather than crashing.

**Routing.** A top-level mention in a channel the bot answers in (anywhere, or its listed channels) by a roster member opens a thread-to-session mapping and starts a bot session as in Phase 6, with the Slack request wrapped as context on the first turn. Replies in the thread continue the session; after a daemon restart the first reply resumes it. Non-members get silence. A thread opened by a since-removed member stops being answered. "done" or a button closes the session and releases the worktree. Deliveries are deduplicated so a retried event never posts twice.

**Streaming and progress.** Use Slack's native streaming where available, with tool calls summarised as timeline updates, and fall back to a single progress message edited in place. Persist enough to finish an interrupted turn exactly once after a restart.

**Decisions in Slack.** Permission requests and agent questions post a message with one button per option and a short id, and accept text verbs as well. "Always allow" offers only rules the agent proposed. The same pending-decision model from Phase 4 serves Slack and the chat panel, so a decision can be answered from either.

**Structured handoff.** The surface instructions ask every Slack bot to end a turn with a fenced handoff block: outcome, a short summary, the pull request link if any, issues touched, and follow-ups. The daemon parses it from the final message, renders a Block Kit card with those fields and a "mark done" action, and falls back to posting the raw text when the block is missing or malformed. The same parsed handoff writes an event to the project's activity feed.

**Agents posting Block Kit.** As a follow-on inside this phase, expose a small MCP server from the daemon to the bot's session, scoped to the current thread, with a single tool that posts a Block Kit payload the daemon validates. This is the pattern for every "wrapped MCP server scoped to an agent" that follows: the agent sees a narrow tool, the daemon holds the credentials and the scope.

## Human test

Add the bot's keys, confirm the card shows connected. From a listed channel, mention the bot as a roster member with a small task referencing an issue id. Watch progress stream into the thread, answer a permission prompt with a button, and confirm the same prompt disappears from the chat panel. Let the bot finish and confirm the handoff card shows the summary, the pull request link, and the issue id. Reply in the thread with a follow-up and confirm the session continues. Restart the daemon mid-turn and confirm the thread recovers with one completion message, not two. Mention the bot from a non-listed channel and as a non-member and confirm silence in both cases. Have the bot post a Block Kit message through the MCP tool.
