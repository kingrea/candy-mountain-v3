# Clanker Corner: architecture report (research for CM v3)

Repo: `~/work/new-orange/clanker-corner`. Paths relative to it. Generated 2026-10-27 by an explorer agent; verify against the code before relying on line numbers.

Corrections to assumptions in the v3 brief:
- Slack keys are NOT in the app. exe.dev's Slack integration holds bot/app tokens and injects them at the edge. The server refuses to start if they appear in its env.
- No stored Claude or Codex token. The stock CLIs keep their own login in a per-user config dir; the server only points them at it.
- Codex persona file is `.agents/<name>.md`, not `.agents/agents/<name>`. Claude persona is `.claude/agents/<name>.md`.
- The Claude shim uses Claude Code's built-in stdio control protocol (`--permission-prompt-tool stdio`), not an MCP server.
- The agent opens its own PR (prompted to push + call host API). The server does not push during a Slack turn.

## 1. Layout and stack

pnpm workspace `packages/*`, `apps/*`. `preinstall` guard rejects npm.

| Workspace | Purpose | Depends on |
|---|---|---|
| `apps/server` | Mastra 1.64 app with no LLM inside. Manages ACP processes, sessions, Slack, worktrees, team roster, git hosts, Jira. | agent-config, claude-acp, jira-reader, `@mastra/core`, `@mastra/acp` 0.4.1 (pinned), `@mastra/libsql`, `@agentclientprotocol/codex-acp` 1.10.0, `@agentclientprotocol/sdk`, `@slack/socket-mode`, `@slack/web-api` |
| `apps/console` | Nuxt 4.5.2 + Nuxt UI 4.11 console: chat with agents, history, bots, team. Nitro only proxies to Mastra (`server/utils/api-proxy.ts`) for same-origin. Uses `@mastra/client-js` with a custom transport. Logic in `app/services/*.ts` with `node --test` tests. | `@mastra/client-js` |
| `packages/claude-acp` | The Claude shim: stdio ACP agent driving the stock `claude` CLI. ~750 lines, self-contained, liftable as-is. | `@agentclientprotocol/sdk`, agent-config |
| `packages/agent-config` | Maps email + family (claude/codex) to a per-user 0700 config dir (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`). Locates repo-scoped git token files. Never reads credentials. | none |
| `packages/jira-reader` | `clanker-jira`, read-only Jira CLI agents run during a session. | none |
| `prototypes/clanker-corner` | Throwaway Vite + Vue UI concept. | — |

Server: Mastra's Hono host; custom endpoints via `registerApiRoute` in `apps/server/src/mastra/index.ts`. Mastra's agent/LLM features deliberately unused; it provides HTTP host, Studio, `AcpAgent`.

DB: one LibSQL file `$CLANKER_DATA_DIR/mastra.db`, raw SQL, per-store `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info`/`ALTER TABLE` migrations. Tables: `console_sessions`, `console_session_events`, `agent_definitions`, `slack_routes` (+history/meta), `slack_threads`, `slack_pending_threads`, `slack_deliveries`, `slack_turn_progress`, `slack_feedback`, `team_roster_members` (+history/meta), `worktree_leases`, `worktree_actions`, `runtime_probe`. Filesystem: worktrees under `CLANKER_WORKTREE_ROOT`, CLI logins + git tokens under `AGENT_CONFIG_ROOT`, per-workspace seed `.env` files under `/etc/clanker-corner/workspaces/`.

## 2. Repository side-loading

- A "workspace" is an already-cloned checkout on the VM, declared in env `CLANKER_WORKSPACES_JSON` `{id, displayName, defaultBranch, location, gitHost?, seedFiles?, jira?}` (`workspaces/registry.ts`). No UI, no OAuth app, no auto-clone; the operator clones by hand.
- Hosts: GitHub, GitLab, Gitea, Bitbucket (`git-host/hosts.ts`). Kind inferred from remote hostname or set explicitly.
- Credentials (`git-host/credentials.ts`): (1) `edge-injected` via exe.dev integration hosts (preferred, nothing stored); (2) `repo-scoped-fallback`: single-repo token file at `$AGENT_CONFIG_ROOT/<sha256(email)>/git-hosts/<host>/<owner>/<repo>/token`, must be 0600, injected via `GIT_CONFIG_*` `http.extraheader`, redacted from errors.
- **Checkout model: one clone per workspace, one git worktree per session** (`worktrees/*`, `docs/worktree-pool.md`). Holder = Slack thread or console session. Path `<root>/<workspaceId>/<slack|console>/<slug>`. Branch `clanker/slack/<botKey>-<team>-<channel>-<ts>` or `clanker/console/<sessionId>`. Caps 5 Slack + 1 console. Idle reclaim after 60 min, never with unpushed/uncommitted work. Startup reconcile cleans orphans. Leases persisted so resume lands in the same path/branch (both CLIs locate conversations by cwd). Offline `pnpm install --frozen-lockfile` from a warm store on create (often fails: P1 bead `qz6`). `seedFiles` symlinks gitignored env files. Main clone never a session cwd; git mutations serialised per clone.
- Base branch: workspace `defaultBranch` from config; a Slack route can set `baseBranch`; Bitbucket-only Block Kit picker of 20 recent branches held in `slack_pending_threads`. Worktree refuses to sit on the base branch. First-turn context tells the agent its branch and target.
- Push/PR: agent does it (prompted via `describeDeliveryForPrompt`). Claude sandbox has `ask: ["Bash(git push *)"]`. PR link scraped from output. Server-side `publishBranch`/`createPullRequest` exist but only used by operator script.

## 3. Claude Code integration (`packages/claude-acp`)

- Compliance stance: only the stock `claude` binary talks to Anthropic, with the user's own subscription login. No Agent SDK, no `claude-agent-acp`, never `--bare`, no API keys.
- One shim process per ACP session, one `claude` child. Server runs `process.execPath <claude-acp dist/src/cli.js> <posture flags>`; real `claude` found on PATH. Child spawned with `claude --print --verbose --input-format stream-json --output-format stream-json --include-partial-messages --permission-prompt-tool stdio (--session-id|--resume) <uuid> ...`. Startup sends `initialize` and checks the account; missing login → ACP `authRequired`. Shim strips `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, Bedrock/Vertex vars.
- `translator.ts` maps stream-json → ACP `session/update`.
- Sessions: `newSession` → `--session-id <uuid>`; `loadSession` → `--resume <id>`. Prompt = user message on stdin. Cancel = `interrupt` control request. Turn timeout pauses during permission prompts.
- Permission relay: CLI emits `control_request{subtype:"can_use_tool"}`; `ClaudePermissionBridge` → ACP `session/request_permission` with Allow once / Always allow (only Claude-suggested rules) / Deny. `AskUserQuestion` → ACP `elicitation/create`. Unexpected = denied, never auto-approved.
- Server side `AcpSessionControls` (`acp/controls.ts`) wraps Mastra `AcpAgent` with `persistSession: true`; permission/elicitation become pending decisions on an event bus consumed by console SSE and Slack. Resume uses a monkey-patched private Mastra method for `session/load` (`acp/mastra-compat.ts`); `@mastra/acp` pinned 0.4.1 with a version check. Session mapping in `console_sessions`; full event log in `console_session_events` for SSE replay.
- Write scope → flags (`acp/posture-claude.ts`): `read-only` → `--permission-mode plan` + deny ExitPlanMode/Agent/Workflow; `workspace-confirmed` → `--permission-mode default`; `workspace` → `acceptEdits` + Bash sandbox + network allowlist + git push asks. All scopes: `--settings {disableAllHooks:true}`, `--append-system-prompt`, `--agent <persona>`, `--allowedTools` (always `Bash(bd *)`), `--disallowedTools`. Checkout's own `.claude/settings*.json` vetted (`acp/checkout-settings.ts`). Persona front matter may not widen posture.
- OAuth from Slack: member DMs `login claude` → server spawns `claude auth login --claudeai` with `CLAUDE_CONFIG_DIR` → parses URL from stdout → DMs with "Paste code" button → Block Kit modal → `code#state` written to stdin, never stored → `claude auth status --json` confirms. Attempts in memory, 10-minute expiry.
- Token storage: the CLI writes its own credential under `$AGENT_CONFIG_ROOT/<sha256(email)>/claude` (0700). Alternative: `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`. Gotcha: `claude auth status` before a thread can hold the OAuth refresh lock; server now catches `AGENT_AUTH_REQUIRED` at session start instead.

## 4. Codex integration

- Official `@agentclientprotocol/codex-acp` 1.10.0 run via `process.execPath`. `@openai/codex` hoisted so `node_modules/.bin/codex` exists.
- Env: `NO_BROWSER=1`; `DEFAULT_AUTH_REQUEST`, `CODEX_CONFIG`, `APP_SERVER_LOGS` emptied; `INITIAL_AGENT_MODE=read-only` (approval `on-request`, `approvals_reviewer:"user"`, `workspace-write` sandbox). Adapter's default `agent` mode rejected (auto_review approved `curl | sh`). Persona/instructions via `CODEX_CONFIG.developer_instructions`. Per-user dir via `CODEX_HOME`.
- Login from Slack: `codex login --device-auth` in member's `CODEX_HOME`; bot DMs URL + one-time code; `codex login status` confirms.
- Sessions: same controls + decision relay. Resume via `session/load`. `UPSTREAM_SESSION_EMPTY` expected for never-run sessions.
- Limitation: every git write from a Codex worktree costs one human approval (sandbox mounts `.git` read-only).

## 5. Bot / agent configuration

A "bot" in the console is a projection (`apps/console/app/services/bot-editor.ts`), made of:
1. A Slack bot identity: one exe.dev Slack integration per bot (`CLANKER_SLACK_INTEGRATION_URL`). `botKey` = integration name. Cannot create a bot in the UI.
2. One agent definition (id = bot key) in `agent_definitions.definition_json`: `AcpAgentDefinition` `{id, name, description, family: claude|codex, command, args, env, surfaces: [console|slack], turnTimeoutMs, posture: {approvals: human|auto-review, writeScope: read-only|workspace|workspace-confirmed|workspace-plus, extraDirectories, instructions, agent (persona), claude: {allowedTools, disallowedTools}, codex: {config}}}`. Seeded once from env.
3. Slack routes (`slack_routes`): `bot_key, channel_id (null = anywhere), team_id (null = any), keyword, agent_definition_id, workspace_id, base_branch`. Seeded once from env.

Built-ins: `claude`, `codex` (console), `slack-claude`, `slack-codex` (slack, with "working agreement" instructions from `slack-agents/guidance.ts`).

Validation: blanket-bypass scanner (`acp/bypass.ts`); Slack-surface definitions must use human approvals; a writer must be able to deliver; persona must exist and may not widen posture.

Persona resolution (`acp/persona.ts`): Claude `.claude/agents/<name>.md` (`--agent <name>`); Codex `.agents/<name>.md` (read into developer_instructions). Must be committed. Checked at startup against each routed workspace's fetched default/base branch (failure disables the definition) and at every session start/resume (`AGENT_PERSONA_MISSING`). Console "Fetch and re-check" (`/console/persona-check`).

Setup UI: `BotEditor.vue` modal, two sections. Setup: persona (with per-repo check badge), provider cards, scope (Read-only / Writable / Confirm each edit, Claude only), approvals, turn timeout. Repositories: per repo: repository, base branch, keyword, Slack team ID, "Answers in" (fallback or selected channel IDs), persona check. Apply runs `planBotSave` (diff into create/update/delete) → review dialog → `executeBotSave`.

## 6. Team

- `team_roster_members`: `slack_user_id` (PK), `owner_email` (fixed), `display_name`, `avatar_colour`, `bot_scope_kind/bots`, `seeded`, audit, `last_active_at`. History table. `/team` form: Slack member id, email, display name.
- Admin: only the console caller whose `X-ExeDev-Email` equals `CLANKER_SLACK_OWNER_EMAIL`. No app-level auth.
- Per-user logins: one Claude and one Codex dir per roster email. Login state via each CLI's status command. Revoke deletes the dir. Logins started only from Slack DMs (`login`, `status`, `logout`).
- Authorisation (`slack-routing/sender-gate.ts`): sender in roster and bot scope covers the bot; non-members get silence; threads of removed members stop; missing Codex login → `LOGIN_MISSING` reply; missing Claude login caught at session start.

## 7. Slack app

- Socket Mode outbound WebSocket through the exe.dev integration host (placeholder app token; Web API base `https://<name>.int.exe.xyz/api/`). One connection per bot. Scopes: `app_mentions:read, channels/groups/im:history, chat:write, reactions:write, users:read`. Events: `app_mention`, `message.*`, `agent_session_stopped`.
- `slack_threads` keyed (bot_key, team_id, channel_id, thread_ts) → session_id, owner, definition, workspace, turn count. New mention: resolve route → acquire worktree → start session with a fenced `<slack-request>` context block. Replies continue; after restart first message resumes. `done` closes and releases the worktree. Deliveries deduped. Router ~1,500 lines.
- Decisions: Block Kit buttons + text verbs (`yes <id>`, `no <id>`, `choose <id> <n>`, `answer <id> ...`).
- Streaming: Slack native `chat.startStream` / `appendStream` / `stopStream`, throttled, tool calls as `task_update` timeline cards; outcome blocks on `stopStream`; fallback to an edited plan message. Thread status needs Slack "Agents" feature. Stream ts persisted for exactly-once completion after restart.

## 8. jira-reader and agent-config

- `clanker-jira read|attachments|sites`: GET-only Jira Cloud reader, site allowlist, ADF→text, attachments, video frames via ffmpeg. Routed through exe.dev http-proxy edge. Launcher written to `$AGENT_CONFIG_ROOT/bin` on session PATH; `<jira-links>` note appended to turns with Jira links.
- `agent-config`: canonical email → sha256 dir key → `{configDir, launchEnv}`; creates 0700, rejects symlinks; resolves git-host fallback token path; server sets `AGENT_CONFIG_ROOT` + `AGENT_OWNER_EMAIL` per session in the child env.

## 9. Versions, running, docs

Node >= 22 (24 on VM), pnpm 11.24.0, TS 6.0.3 root, `@mastra/core` 1.64.0, mastra CLI 1.27.3, `@mastra/acp` 0.4.1 pinned, `@mastra/libsql` 1.22.3, `@libsql/client` 0.18.0, `@mastra/client-js` 1.43.0, `@agentclientprotocol/sdk` ^1.4.0, codex-acp 1.10.0 (codex 0.153.4), Claude CLI 2.1.2xx, `@slack/socket-mode` ^3.0.1, `@slack/web-api` ^8.1.1, zod 4.5.4, Nuxt 4.5.2, Nuxt UI 4.11.0, Tailwind 4. Tests: `node --test --experimental-strip-types`, ~100 server files.

Runs on an exe.dev VM under systemd (`clanker-server` :4111 `mastra start`, `clanker-console` :4112 Nitro). `scripts/deploy-vm.sh`. `mastra build` needs network.

Docs: `.ai-docs/00-overview.md` + phases 01–08 (decisions 2026-09-24), `docs/exe-deployment.md`, `docs/local-runbook.md`, `apps/server/docs/{slack-connection,slack-routing,slack-decisions,slack-progress,slack-agent-definitions,worktree-pool,git-host-delivery,jira-access}.md`, `apps/server/src/acp/README.md` (~1,500 lines), `apps/console/README.md`.

Open pain (beads): `qz6` P1 worktrees lack deps; `81v` structured final handoff; `8uo` overview + "Do it" button before edits; `87c` checkout sandbox settings may auto-approve Bash; `2nl.*` Slack Home tab; `ocl` env set per worktree; `41l` pick up PR review feedback; `ddp` Playwright screenshots in PRs; `e00` Bitbucket docs.

## Works well

- Clear compliance boundary (stock CLIs, own login, per-user 0700 dir, no app-stored tokens).
- The Claude shim is small and self-contained; most reusable piece.
- Posture model (approvals × write scope × persona × tool rules) with per-family translation and verification, refusal codes.
- Worktree pool: per-session branches, stable paths, leases, safe reclaim, seeded files.
- Decisions never auto-answered; one relay for console and Slack; durable event log with SSE replay.
- Slack UX: native streaming, timeline cards, buttons, branch picker, DM login with modal.

## Awkward

- Config split: workspaces + Slack integrations only in env JSON; definitions/routes/roster in DB seeded once from env. Bots cannot be created and repos cannot be connected from the UI.
- Everything assumes exe.dev (trusted email header, edge secrets, `*.int.exe.xyz` allowlists).
- Mastra adds little but needs private-method patches pinned to 0.4.1; prompts text-only.
- Delivery depends on the prompt; PR URL scraped; branch picker Bitbucket-only.
- Codex costs one approval per git write; Claude auth refresh-lock workaround; offline installs often fail.
- Hand-rolled persistence; very large files (`router.ts` ~1,480, `controls.ts` ~1,260, `progress.ts` ~1,150); verbose docs/comments.

## Hard to port into a Nuxt-layer capability

- Needs a long-lived Node host (live session map, child process trees, stdin login attempts, per-bot Socket Mode websockets, per-clone locks). Nitro node-server preset only, single instance.
- Needs filesystem + OS access (clones, worktree root, warm pnpm store, 0700 dirs, Claude Bash sandbox).
- Edge-secret model must be replaced with app-stored encrypted Slack/git tokens and a real user/auth model.
- Mastra coupling: swapping `AcpAgent` for the ACP SDK client directly removes the patches but means re-implementing session/load and elicitation plumbing from `controls.ts`.
- Moving config to the DB needs new tables and UI plus keeping the persona-exists checks.
