# Platform extraction orchestration, 2026-11-01

Run of epic `candy-mountain-v3-ncj` in parallel mode, up to three subagents, one shared checkout, no commits.

## Status

| Epic | State |
|---|---|
| ncj.1 Phase 1: Daemon registration seam | closed, 19 tasks (1.1 to 1.15 plus follow-ups 1.16 to 1.19) |
| ncj.3 Phase 3: Web shell seam | closed, 11 tasks |
| ncj.2 Phase 2: Data ownership | open epic, not yet decomposed |
| ncj.4 Phase 4: Packages and distributions | open epic, not yet decomposed |
| ncj.5 Phase 5: SDK test kit and template capability | open epic, not yet decomposed |

Final gates on the full tree (run by the last agent, nothing else in flight): `pnpm lint`, `pnpm --recursive --workspace-concurrency=1 typecheck`, `pnpm test` (168 files, 1525 passed, 3 skipped), `pnpm build` all green.

## Uncommitted tree

292 paths: 183 modified, 32 deleted, 77 untracked. Nothing has been committed or staged. Suggested next commands once reviewed:

```bash
git status
git add -A
git commit
```

## What landed

- Daemon boots from a `Product` (shared `ProductConfig` + capability definitions + modules + product plugin types) and a runtime capability definition list. Every capability has a definition: issues, slack (service-only), bots, team, chat-claude-code, chat-codex, uptime, deployments, overview, platform-agent, plus a platform-owned `threads` definition that owns the session store.
- `platform.ts` and `app.ts` import no capability; `apps/daemon/src/seam.test.ts` guards that.
- `GET /info` returns product name and scope label.
- Web shell reads name, theme, manifest, scope label, URL prefix and layer list from the product configuration. Plugin panels, forms, icons, chat family pieces, the bot worktree card and the repository facts card live in the layers that own them, registered through contribution points. New layers: repository, chat-claude-code, chat-codex, slack.
- Closed id unions in packages/shared are gone; ids are strings validated at daemon boot.

Per-bead details and the interfaces dependents need are in each bead's notes (`bd show <id>`). Orchestrator decisions are in `bd memories platform-extraction` (batches a to i).

## Decisions Jack should know about

1. A daemon without chat-claude-code must still serve platform-agent threads, so 1.11 split the session store and native-turn runner into a platform-owned `threads` definition. This widened 1.11 well past its two points and ran on Fable.
2. `threads` is injected by the platform (`platformDefinitions()`), not listed in the product configuration.
3. Bots now hard-depend on chat-claude-code, chat-codex and slack. A product without any of those must drop bots.
4. The former single Project card on the overview is now two cards: Project (organisation) and Repository.
5. Document titles now carry the product name (`Sign in · Candy Mountain`), because 3.1's acceptance named document titles.
6. Mastra storage init is awaited on the first platform-agent turn, not at boot.
7. Slack notification failure text changed from "No Slack identity: …" to "No delivery channel: …".

## Human tests still to walk

- Phase 1: same boot log; remove uptime from the product and its routes answer not found; a manifest naming a missing plugin type refuses boot. Automated in `apps/daemon/src/capabilities/boot.test.ts`, worth one manual run.
- Phase 3: Plugins page shows Repository, Claude Code and Codex panels and icons; a bot thread shows the worktree card; model and effort controls appear for Claude Code and Codex threads; the overview shows the Repository card. No agent opened the app in a browser.
- Build with `CM_WEB_LAYERS=product` and compare.

## Follow-ups filed or noted for later phases

- Platform modules still import bots: `threads/service.ts`, `threads/routes.ts` (BotStartError, bots table), `registry/load.ts` (listProjectBotRefs).
- `threads/sessions.ts` imports `sessions/errors.ts` and `sessions/store.ts`; `threads/routes.ts` imports `sessions/routes` and `sessions/access`. Move into threads/.
- MODULES and PLUGIN_TYPES are product data in platform folders; ACTIVITY_EVENT_TYPES names product events.
- Shared `threads.ts` still carries bot fields (ChatThreadBot, threadClosePath).
- Core web still names slack in notifications setup; overview activity kinds still name product events.
- BOT_FAMILIES in shared is still closed (guarded at boot by bots).
- Daemon text outside registry/ may still say "project".
- Model/effort piece is duplicated in chat-claude-code and chat-codex layers.
- Daemon README "Durable agent sessions" paragraph still says chat-claude-code binds THREAD_SESSIONS.

## Next step

Per the plan, phases 2, 4 and 5 are decomposed only after 1 and 3 land. They have landed. Decompose phase 2 next (depends on 1 only), then 4 and 5.
