# Candy Mountain v2: findings for the v3 rewrite

Repo: `~/work/candy-mountain` (branch `staging`, 481 commits 2026-06-30 → 2026-09-20). ~167k tracked lines in `src/` + `frontend/src`, a large share tests. Generated 2026-10-27 by an explorer agent; verify against the code before relying on line numbers.

## 1. Layout

| Path | What |
|---|---|
| `src/mastra/` | Mastra backend. `index.ts` registers agents/tools/workflows. `server/routes/*`, `tools/` (bd wrapper, worker tools, orchestration), `harness/` (ACP), `plugins/` (bundles, OAuth, sources), `digests/`, `quests/`, `planning/`, `projects/`, `secrets/`, `kb/`, `meditation/`, `reports/` (retired), `git/`, `models/`, `voice/`, `workflows/` |
| `frontend/` | Vite + Vue SPA, hash router. `src/pages`, `src/components/<domain>`, shadcn-vue primitives in `src/components/ui`, API clients in `src/lib/*.ts` |
| `plans/` | One plan per phase (1–29) + `roadmap.md`. `plans/future/` superseded ideas |
| `quests/templates/`, `trials/`, `agents/` | Quest templates, trial templates, agent definitions (markdown + frontmatter) |
| `deploy/` | Docker: server image, per-project images, compose, onboarding scripts |
| `.candy-mountain/` | This repo's own project state (plans, quests, harness homes, `plugins.json`, `secrets.enc.json`, `models.json`, `people.json`, kb, meditations) |

`projects.json` (gitignored, read live by `src/mastra/projects/projects.ts`): `slug`, `name`, `kind` (project | organisation), `org`, `description`, `color`, `avatar`, `path` (legacy local), `target` ({type:'local', path} | {type:'container', container, path}), `beadsPath`, `slackChannel`, `defaultLeader`, `repo: {host: github|bitbucket, owner, name}`. Local file: 3 orgs + 10 local projects, no container projects. Data: local projects `<path>/.candy-mountain/`; container projects `<serverRoot>/.candy-mountain/projects/<slug>/`; orgs `~/.candy-mountain/orgs/<slug>/`; global `~/.candy-mountain/global/` (`CM_GLOBAL_DIR`, does not exist on this machine).

## 2. Beads viewer (the daily driver)

**Data path:** shells out to `bd` CLI for everything; no jsonl reads, no Dolt queries (except comment edit). No cache, no realtime; refresh is manual.
1. Frontend calls `mastraClient.getTool('<id>').execute({data, requestContext:{projectId}})` → Mastra built-in `POST /api/tools/:toolId/execute` (`frontend/src/lib/beads.ts`).
2. `src/mastra/tools/beads-tools.ts`: `runBeadsCommand` runs `execFile('bd', [..., '--json'], {cwd})` on host, or `docker exec` for container projects. cwd order: `requestContext.beadsCwd` → project `beadsPath`/target path → `BEADS_DB_PATH` → `process.cwd()`.

| Tool | bd command |
|---|---|
| `list-beads` | `bd list --all --limit 0 --json` (limit 0 so parent epics aren't truncated); `ready` intersects with `bd ready` |
| `show-bead` | `bd show <id> --json` |
| `list-bead-deps` | `bd dep list <ids...> --json` |
| `create-bead` | `bd create --title --description --type --priority [--acceptance --labels --metadata --parent --deps]` |
| `update-bead` | `bd update` (status, assignee, parent (`""` detaches), labels, claim) |
| `close-bead` | `bd close` |
| `move-bead` | create + close with cross-references |
| `list-bead-comments` / `add-bead-comment` | `bd comments <id>` / `bd comments add <id> <text>` |
| `update-bead-comment` | bd 1.2.2 can't edit comments; runs `bd dolt show --json` then `dolt --data-dir ... sql -q "UPDATE comments ..."` and reads back |

Other routes: `POST /projects/:slug/beads/:id/move`, `GET|POST /projects/:slug/people` (assignees in `people.json`), `GET /api/agents`, `GET /agents/roster?project=`, `create-bead-workflow` (LLM `beadDraftAgent` normalises free text, then `bd create`).

**Components (`frontend/src/`):**
- `pages/BeadsPage.vue` (`/beads`): fetches whole list; Show closed toggle; Refresh; Create. Grouping (`:111-199`): top-level epics (parent not an epic) become groups; child epics recursive with a `seen` cycle guard; closed epic with nothing visible hidden unless Show closed; non-epic-parent beads land in "No epic"; open/total counts over all children. Hosts the slide-out and bulk bar.
- `components/beads/EpicGroup.vue`: Card + Collapsible (open by default); chevron, truncated title, short id button opening the sheet, `(assignee)`, "N open / M total".
- `NestedEpicSection.vue`: recursive sub-epics with `border-l` indent; no collapse, no counts.
- `BeadRow.vue` (Monaspace font): checkbox; priority flame (P0 red→yellow gradient, P1 red, P2 yellow, P3 sky, P4 grey, `PriorityFlame.vue`); short id via `displayBeadId` (prefix stripped, uppercased, full id in tooltip); title (struck when closed); violet `stage:*` chip; sky "research" chip; status badge; type icon+label (bug red Bug, feature purple Origami, task blue Squirrel, epic amber Orbit, decision teal Split, chore zinc BrushCleaning); assignee; comment count. Row click opens sheet; checkbox toggles selection.
- `lib/bead-order.ts sortBeads`: hierarchical id sequence → numeric-aware title collation → topological pass on `blocks` deps between siblings. Tested.
- Slide-out: shadcn `Sheet` (right, `sm:max-w-xl`): full mono id, copy button, "Open page" link, back arrow with 10-entry history; body `BeadDetail`.
- `pages/BeadPage.vue` (`/beads/:id`): same `BeadDetail` in a `max-w-4xl` card; `?project=<slug>` override for org routing; breadcrumb shows title.
- `BeadDetail.vue`: title + Run button; status badge, tinted `IssueTypeBadge`, `P#`, stage chips, labels; fields: assignee (unassign + `AssigneePicker` datalist from `people.json` + agent slugs), parent (clickable), created/updated, closed at/reason; markdown Description / Acceptance / Notes; Depends on / Dependents / Children (parent-child edges split); "Move to project" in org context; `BeadComments`. **No editing of title, description, priority, type.**
- `BeadComments.vue`: author, timestamp, markdown body; pencil inline edit; add textarea. `BeadMarkdown.vue` via markdown-it + DOMPurify.
- `BulkActionBar.vue`: floating sticky bottom: "N selected" | Run | Add to epic… | New epic | Remove from epic | AssigneePicker | Change status… | Clear. One-shot selects. New epic dialog creates then reparents. Bulk updates = sequential client loop of `update-bead`.
- `CreateBeadDialog.vue` + `lib/create-bead.ts`: free text → LLM workflow; module-level state so closing doesn't cancel; minimised "Creating…" bar; sonner toast with Open.

**Run action:** does NOT open an agent chat. `seedQuestFromBeads(ids)` writes a sessionStorage prefill and routes to `/quests/new` (vue-flow Quest Builder) → pick trek leader → Start → `run-quest-workflow`. Leader is an ACP Claude Code session; `LeaderChatDialog.vue` on live/camp pages. `/harness-chat` cannot be seeded with a bead. For v3 "bead → Run → chat", reuse `useHarnessChat` and `HarnessPermissionCard`.

**UI library:** shadcn-vue on reka-ui 2.10 (`components/ui/*`), lucide icons, vue-sonner, Tailwind 4 theme in `frontend/src/style.css` with Nuxt-UI-style semantic vars (`text-dimmed/muted/toned/highlighted`, `bg-elevated/accented`, `border-muted`; primary pink, neutral slate). Fonts via @fontsource (Kablammo, Monaspace Neon, Noto Serif, Fraunces). Optional "game-skin" layer (bevels, grain, hero patterns, mountain backdrop, styled modals). Worth carrying: status colour map (duplicated in BeadRow and BeadDetail), type colours/icons, priority flame, short ids with tooltip + copy, `stage:*` chips.

## 3. Plugin system (`src/mastra/plugins/`)

- Types are code bundles: `bundles/<id>/index.ts` exporting `definePluginType({...})`, registered statically in `registry.ts`; fails at build on duplicate ids, incoherent scopes, sources without health. No dynamic loading.
- Definition: `id`, `name`, `description`, `highlights[]`, `scope`/`supportedScopes` (project | organisation | global), `configFields` + zod `configSchema`, `secretsSchema` (write-only), `reach[]` (plain-language trust lines), optional `mcpServers`, `tools`, `reportSources`, `trialActions`, `gitHost`, `sources`, `webhooks`; hooks `oauth`, `harness`, `migrateConfig`, `onDelete`, `healthCheck`, `capabilityHealth`.
- Instances: rows `{slug, type, label?, config, disabled}` in `plugins.json` in the owner's data dir or global dir. Identity `scope:owner:slug`.
- Secrets (`src/mastra/secrets/secrets-store.ts`): one `secrets.enc.json` per entity, AES-256-GCM, master key `CM_SECRETS_KEY` (32 bytes base64), keys `plugin.<slug>.<key>`, write-only API, atomic 0600 writes. OAuth (`plugins/oauth/`): PKCE + state, encrypted rotating tokens, account pinning, manual fallback; callback from `CANDY_MOUNTAIN_PUBLIC_URL` (needs a tunnel).
- Bundles: `slack-workspace` (org/global), `github`, `bitbucket` (git host, webhooks, activity sources), `jira-cloud`, `microsoft-365` (global), `claude-code` (project; pasted `claude setup-token`), `codex` (project; device login or API key; `auth.json` seeded into harness home). No docker plugin, no digest plugin.
- Scaffold `pnpm scaffold:plugin <id>`; shared contract test suite. UI `PluginsPage.vue`, `PluginInstancePage.vue`.

## 4. Agent chat over ACP (`src/mastra/harness/`)

- Spawn: `acp-harness.ts`. Local target runs `node_modules/@agentclientprotocol/{claude-agent-acp@0.70.0, codex-acp@1.4.0}/dist/index.js`; container target `docker exec -i <container> node /opt/acp/...` with credential from a 0600 env file. Isolated HOME `.candy-mountain/harness/<id>`. Env allowlisted (`harness-env.ts`): API-key/gateway vars blanked so billing stays on subscription. Wraps `new AcpAgent` from `@mastra/acp@0.4.0` with `persistSession: true`. `acpHandshake` for health and Codex model discovery.
- `harness-agent.ts` `HarnessAgent extends Agent` delegating to a cached `AcpAgent`; one live session per project (or project#partition) in an in-memory Map. Chat agents `harness-chat-claude-code`, `harness-chat-codex`. Model/effort via request context; change = fresh session.
- Streaming: `HarnessChatPage.vue` → `useHarnessChat.ts` → `client.getAgent(id).stream()` (Mastra `POST /api/agents/:id/stream`). `harness-chunks.ts` maps ACP events to native chunk vocabulary (text, reasoning, tool-call/result, usage, finish), side channel for events `@mastra/acp` drops (thoughts, plans, usage/cost), re-segments text. Client folds with `components/chat/chunk-reducer.ts`.
- Permissions: `session/request_permission` → tool-call/result pair named `harness-permission` → `HarnessPermissionCard.vue`. Server blocks on a promise in a module registry; browser answers `POST /projects/:slug/harness-chat/:kind/permission/:requestId`. Modes `always-ask` (default) / `auto` (policy `workspace` = allow inside project root, or `deny`). `bypassPermissions` refused by name. Auto-refuse after `CM_HARNESS_CHAT_APPROVAL_TIMEOUT_MS` (5 min). Decisions by option kind, never position.
- Lifecycle: per-connection points budget by model tier with FIFO queue (`harness-budget.ts`); idle reaper every 15s (`harness-reaper.ts`). Routes: session, reset, permission-mode.
- Persistence: harness chat transcripts NOT persisted (page state only); server restart loses sessions. Only planning-on-harness writes to memory threads. `mastra_harness_sessions` table has 0 rows.
- Fragility: `@mastra/acp` pins ACP SDK 0.21.1, forced to 1.3.0 by pnpm override + `scripts/postbuild-acp-sdk.mjs`. Bead `2cs1` open ("deployed image reverts to SDK 0.21.1"). No `set_config_option`, so no Claude effort control.

## 5. Docker non-local source (Phase 8)

- Design (`plans/phase-8-container-isolation.md`, `deploy/README.md`): one CM container with the Docker socket; per-project `cm-<slug>` containers with repo at `/workspace` on a volume, toolchain, bd, dolt, unprivileged `worker`, `sleep infinity`. All execution via `docker exec` (`container-exec.ts`, `container-sandbox.ts` as Mastra `WorkspaceSandbox`, `container-filesystem.ts`). ACP adapters baked into `deploy/project-node/Dockerfile`.
- Done (2026-07-06): M0–M3 (registry `target`, ContainerSandbox, file tools, images, compose). UI toggle in `ProjectSettingsForm.vue`. `deploy/add-project.sh` one-shot onboarding.
- Not finished: epic `8j2` in_progress; `8j2.6` VPS end-to-end smoke test open; `8j2.5` M4 hardening (socket proxy, egress lockdown, per-container secrets) open.
- Limitations: `.candy-mountain/` state for container projects lives on the server; native `coding` toolset refuses container projects; LSP off; container bd 1.1.0 vs local 1.2.2; no auth beyond `CM_API_KEYS` + Traefik basicauth + tailnet.

## 6. Digests (Phases 20–27)

Global `DigestDefinition` (intent only): name/slug, enabled, selected plugin sources + guidance, schedule, lookback, model roles, auto-bead toggle. Run: preflight → per-source `analyze-digest-source-workflow` (collector pages/cursors, chunked evidence, analysis agent → findings with destination project + confidence, duplicate search) → overview agent → persist → commit cursors → optional `stage:proposal` beads. UI: `DigestsPage`, `DigestEditorPage`, `DigestRunPage`. Sources: Slack, Jira, M365, GitHub/Bitbucket. Jira epic `w9nw` open. No digests defined locally. Legacy Reports retired but code remains.

## 7. Other capabilities

| Feature | State |
|---|---|
| Quests / treks / camp / decisions (phases 3, 11, 29): `src/mastra/quests/` ~40 files, `run-quest-workflow.ts` 1857 lines, `QuestBuilderPage` 1035, `QuestLivePage` 1099 | Heavily built, still churning; Phase 29 epic open, builder redesign `7zow` open |
| Trials (phase 4) | Built; end-to-end exercise open |
| Planning pipeline (phase 5): `PlanningPage`, milkdown `PlanEditor` | Built; bead planning flagging unbuilt |
| Single-bead workers (phase 2) | Built; superseded by trek leaders |
| Parallel workers (phase 18) | Not built |
| Meditation (phase 9) | Built |
| Knowledge base (phase 14) | Built; live verification open |
| Overseer + Slack + MCP (phases 7, 17): `/api/mcp/candy-mountain/mcp` 22 tools | Built; live verification open |
| Organisations (phase 13): org backlog, move-bead | Built |
| Agents roster (phase 10) | Built |
| Role-based models, voice STT, avatars, Dashboard, UI Kit | Built |
| Uptime | Does not exist |

## 8. Storage

- LibSQL `file:./mastra.db` relative to cwd → live DB is `src/mastra/public/mastra.db` (49 MB). Tables all Mastra built-ins. 36,708 workflow snapshots, 36,433 of them `__mastra_notification_dispatcher` (bloat).
- DuckDB observability `src/mastra/public/mastra.duckdb` (155 MB); single-writer lock is a recurring pain (stale `mastra dev` crashes the next).
- App state is JSON files via `storage/atomic-json.ts`: `projects.json`; per project `.candy-mountain/{quests,plans,kb,reports,meditations,models.json,people.json,plugins.json,secrets.enc.json,harness/}`; global/org dirs under `~/.candy-mountain/`.
- Beads live in each repo's `.beads/` (embedded Dolt), accessed only via `bd`.

## 9. Stack

`@mastra/core` 1.47.0, mastra CLI 1.16.0, `@mastra/acp` 0.4.0, `@mastra/libsql` 1.14.2, `@mastra/duckdb` 1.5.0, `@mastra/client-js` 1.28.0, vue 3.5.39, vue-router 4.6.4 (hash), vite 8.1.0, tailwindcss 4.3.1, reka-ui 2.10.1, milkdown 7.21.2, vue-flow 1.48.2, zod 4.4.3, TS 6.0.3, vitest 4, ACP adapters claude 0.70.0 / codex 1.4.0. Node >= 22.13 (local 24.22.1; images node:22). bd 1.2.2 local.

Run: `pnpm dev:all` (mastra :4111 + vite :5173); frontend calls API directly; Bearer key in localStorage when `CM_API_KEYS` set. Deploy: `deploy/` Docker + Traefik (`home./api./hooks.candymountain.cloud`), CI on push to `master` over Tailscale SSH.

## 10. Purpose, decisions, pain

- README: "a Mastra-backed beads UI"; roadmap grew into an orchestration platform.
- Decisions: tools/routes first, UI second; plugin types are code; global is a real scope; definitions are intent, runtime state separate; subscription-billing safety; `bypassPermissions` never automatic; readiness from `bd ready` not `bd list --ready`.
- Abandoned: `@mastra/claude` SDK workers (→ ACP); Reports (→ Digests); sequential bead loop (→ leader turns); planned-bead schema gate; M0 spike surfaces.
- Pain: orphaned dev stacks (ports, DuckDB lock); brittle ACP SDK override; `@mastra/acp` drops events; bd quirks (no comment edit, unknown ids return `{error}` exit 0); many "Verify Phase N live" beads open; type error bead `9ian`.

## Keep / drop / unfinished

**Keep (beads viewer):** `bd --json` as sole source of truth (no shadow DB) with per-project cwd; grouping algorithm + `sortBeads` and tests; row design (flame, type icons/colours, short ids, chips, status map, comment count, Monaspace); EpicGroup collapsibles with counts; recursive NestedEpicSection; Sheet slide-out with history/copy/open-page; shared BeadDetail; `/beads/:id` deep links; floating BulkActionBar; BeadComments with inline edit (dolt SQL workaround until bd supports it); NL create with background + toast; AssigneePicker; reka-ui primitives, lucide, sonner, markdown-it + DOMPurify, semantic tokens. Game-skin optional.

**Keep (backend ideas):** ACP harness core (curated env, decisions by option kind, approval cards with always-ask/auto, chunk re-segmentation, idle reaper, points budget), consider `@agentclientprotocol/sdk` directly instead of `@mastra/acp`; project registry schema with local vs container target; AES-GCM per-entity secrets store; `deploy/` container-project pattern if remote sources matter.

**Drop or rethink:** Mastra generic `/api/tools/:id/execute` as the beads API (every click spawns a `bd` process; want dedicated REST, bulk update, cached list); quest/trek/camp/decision machinery; meditation, KB, overseer/Slack chat, reports, M365, OAuth framework unless used; DuckDB observability; notification-dispatcher snapshot bloat; bead-ID-laden docblocks.

**Unfinished / not fit:** Run detours through Quest Builder; harness transcripts not persisted, sessions die on restart; container isolation not smoke-tested, M4 open, container projects need special agents; Jira digest acceptance open; planning flagging unbuilt; parallel workers unbuilt; many live-verification beads open; org `new-orange` has no beads workspace; bd version drift container vs local; detail view can't edit title/description/priority/type.
