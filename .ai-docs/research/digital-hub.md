# Digital Hub: architecture report (research for CM v3)

Repo: `~/work/baby-bunting/digital-hub`. Paths relative to it. Generated 2026-10-27 by an explorer agent; verify against the code before relying on line numbers.

## 1. Monorepo layout

pnpm workspace: `apps/*`, `packages/*`, one `patchedDependencies` entry for `@mastra/mcp@1.17.2`. Root pins `pnpm@10.30.2`.

| Package | Purpose | Depends on |
|---|---|---|
| `apps/hub` | Nuxt 4 + Nuxt UI v4 frontend (dashboard shell, capability layers, chat panel). No `server/` dir, no Nitro API. | `@bb/hub-contracts`, `ai`, `@ai-sdk/vue`, `@comark/nuxt` |
| `apps/mastra` | Separate Mastra server (port 4111). Every agent, tool, workflow, gate, permission, store, plugin, custom HTTP route, plus the uptime poller. | `@bb/hub-contracts`, `@mastra/*`, `@libsql/client`, `ai`, `zod` |
| `apps/fake-services` | Tiny Node HTTP servers as toggleable health endpoints for uptime demos. | none |
| `packages/hub-contracts` | Wire contract between hub and Mastra: types + `as const` vocabularies (roles, refusal codes, registry shape, chat, uptime, plugins, grants, paths). Raw `.ts`, no build. | none |

## 2. Capabilities

A capability is defined twice (server manifest + hub Nuxt layer), tied together only by id strings.

**Server side (source of truth):** `apps/mastra/src/mastra/capabilities/capability.ts`
- `CapabilityManifest`: `id`, `label`, `description`, `views[]` ({id,label,icon,path}), `agents[]`, `jobs[]` (workflowId), `requiresPlugins[]`, `tools[]` ({id, kind: tool|operation, scope?}), `ladder[]` of Rungs.
- `Rung`: `{name,label,description, views: viewIds[], chat: boolean, tools: {toolId: {scope?}}}`.
- `defineCapability()` validates at boot: ladder starts with `none`; rungs monotonic; referenced views/tools exist. Bad manifest = boot failure.
- Registry is a hardcoded list in `capabilities/index.ts` (`CAPABILITY_IDS`, `CAPABILITIES`). Not discovered.
- Examples: `uptime.ts` (1 view, 4 tools, none→read), `investigator.ts` (1 view, 1 agent, 2 jobs, 3 required plugins, scoped tools, none→summary→full→investigate), `hub.ts` (global chat agent, no views), `settings.ts` (admin only).
- Cross-manifest checks `modules/index.ts assertManifests()`: unique ids/agents/tools/views/paths, required plugins exist, module refs valid.
- Readiness `capabilities/readiness.ts`: ready when every `requiresPlugins` entry is `fixture` or `live-authorised`. Module degraded when any capability not ready.

**What a capability contributes (all hand-wired):**
- Mastra agents registered in `index.ts`; chat-enabled ones also in `CHAT_AGENT_IDS` (`chat-agents.ts`).
- Gated tools via `createGatedTool({capability})`.
- Workflows/jobs; HTTP routes added by hand to `server.apiRoutes`.
- Hub UI: Nuxt layer at `apps/hub/layers/<capabilityId>/` with `nuxt.config.ts` (component prefix), `app/pages|components|composables|utils|types`, `test/nuxt/*.nuxt.test.ts`. Nuxt 4 auto-registers `layers/*`; no `extends` list. Layer name = capability id. Layers: uptime (pilot), investigator, overview, plugins, audit, settings, and shared `chat`.
- Chat presentation via `chat` key of the layer's `app/app.config.ts` (defu-merged): `agents[agentId]` (empty state), `toolLabels[toolId]`, `routes[path]`.
- Nav items come from the server registry, not the hub. Hub has `app/utils/view-routes.ts` `VIEW_ROUTES` (view id → route) in core.

**Layer boundary rules** (custom ESLint: `apps/hub/eslint/layers.mjs`, `layer-boundaries.mjs`):
- Allowed: capability→core, capability→chat, chat→core, core→chat. Forbidden: capability→capability, chat→capability, core→capability.
- Every auto-import carries its layer prefix (`useUptime`, `UPTIME_HISTORY_STRIP`). `~/` is core, `#layers/<name>/` is the layer's own files.

**Tiers:** module members (investigator, overview, uptime in `codebase`); standalone capabilities granted directly (hub, plugins, audit); the fixed System nav group (home, plugins, audit, settings) never granted. `settings` is ungrantable (admin only). The chat layer is infra, not a capability.

## 3. Modules, grants, permissions

- Module: `{id,label,icon, capabilities: [{capabilityId, defaultRung}]}` (`modules/module.ts`). Only one module: `codebase`.
- Capability in several modules is supported (`listModulesWithCapability`) but unexercised. Actor's rung = max across grants.
- Navigation: each held module becomes a sidebar group of the views its capabilities show at the actor's rung. Server `routes/registry.ts` `buildRegistry`; client `useRegistry.ts` → `HubNav.vue` (`UNavigationMenu`). Admins see degraded modules with a warning tooltip.
- Roles fixed in `hub-contracts/src/actor.ts`: Developer, Customer Care, Admin, System. Grants are per role, not per user.
- `permissions.ts resolvePermissions(roles, grants)` → per capability the highest rung. Admin = top rung (computed). System = fixed. Fails closed.
- Grant shape `{role, target:{kind:'module'|'capability', id}, rungs:{capabilityId: rungName}}`.
- Enforcement: Gate 1 (rung grants tool), Gate 2 (scope narrowing/refusal), Gate 3 (output allowlist + HMAC PII tokenisation), chat route checks `rung.chat`, `gateOperation` for routes, `ViewGate.vue` soft lockout. Every gated call writes an audit row (`hub_tool_audit`).
- DB: raw SQL over `@libsql/client`, one SQLite file `apps/mastra/mastra.db`, shared with Mastra's own tables. Each store `CREATE TABLE IF NOT EXISTS`, no migrations. Tables: `hub_settings` (namespaced KV: grants, agent-appearance, meta), `hub_tool_audit`, `hub_chat_thread_runs`, `hub_chat_thread_reads`, `hub_uptime_checks`, `hub_uptime_incidents`, `hub_order_investigation_runs`.
- `GET /registry` returns actor, modules (views + degraded), system group, capabilities (rung, readiness, views, modules), agents (only where rung.chat, with avatar, allowed tool ids), roles (admin only). Nav, chat rail, view gating, admin pages and the Hub agent's prompt all derive from it.

## 4. Agent chat panel

- Agent registration touches 4 places: `createGatewayAgent()`, `new Mastra({agents})`, a manifest's `agents`, `CHAT_AGENT_IDS`.
- Granted agents: `registry.agents` filtered by `rung.chat`. Rail "+" menu lists them. Avatar from admin override else manifest.
- Tools attached statically per agent; no per-request filtering. Gates refuse at execute time with typed `Refusal` values; `GATE_RELAY_INSTRUCTIONS` makes the agent relay refusals. Hub agent instructions built per request from the actor's registry; `open-view` / `start-chat` tools return actions the browser applies.
- Wrapped MCP: `sources/hosted-mcp.ts` holds one server-side `MCPClient` per vendor; plugin `live.ts` maps typed operations onto `callTool`; gated tools call `getSourceAdapter(id).call(op, input)`; output passes Gate 3. MCP never handed to agents directly.
- Streaming: SSE with AI SDK UI message stream (v7). `POST /chat/:agentId` custom route (not under `/api`, so actor middleware attached per route). Uses `handleChatStream` from `@mastra/ai-sdk` + `createUIMessageStreamResponse`. Avoids Mastra `chatRoute()` deliberately. Contract doc: `apps/mastra/docs/chat-stream-contract.md`, pinned `ai@7.0.83`, `@ai-sdk/vue@4.0.83`, `@mastra/ai-sdk@1.10.0`.
- Client: `layers/chat/app/composables/useChatStore.ts`, one `useChat` per thread in a Map inside a detached effectScope. Browser calls Mastra directly cross-origin with `x-actor-id` header. `dashboard.vue` mounts `<ChatPanel/>` + `<ChatRail/>` on every page.
- Memory: one shared Mastra `Memory` on LibSQL, `lastMessages: 20`, semantic recall and working memory off. Thread `resourceId` = actor id via reserved `mastra__resourceId`. Thread routes: list (unread/working flags), messages, read. Run state in DB with 5-minute stale timeout. Titles via Haiku. Client polls threads every 15s. Half-streamed replies not resumed.

## 5. Mastra usage

- Separate process: `mastra dev --env ../../.env --request-context-presets ...` on :4111. Boot order: installAuditLog, registerPlugins (explicit, because `mastra build` tree-shakes side-effect imports), assertManifests, seedHubSettings, startUptimePoller, then `new Mastra({...})`.
- Models allowlist in `models.ts` through an internal OpenAI-compatible LLM Gateway.
- Nuxt → Mastra: plain `$fetch.create({baseURL: mastraUrl})` plugin stamping `x-actor-id` from a cookie. No client-js, no Nuxt proxy. Most fetches `server: false`.
- Auth between the two: none beyond the spoofable header.
- Two route families: built-in `/api/*` guarded globally; custom routes at root each attach the actor handler themselves.

## 6. Uptime

- Monitors: static `apps/mastra/uptime.services.json` validated by zod (`uptime/registry.ts`). Fields: id, name, team, healthUrl, controlUrl?, checkIntervalSeconds, kind (placeholder | fake | statusio | statuspage | statping).
- Scheduling: in-process `setTimeout` chain per service (`uptime/poller.ts`), `globalThis` singleton to survive `mastra dev` reloads. 5s fetch timeout, `redirect: manual`.
- State derived (`uptime/state.ts`): down = newest 3 checks all failed; degraded = any failure or latency > 2000ms in window; up; unknown. Rebuilt from history on restart.
- Storage: `hub_uptime_checks`, `hub_uptime_incidents` (opened on down, closed on recovery; records investigation summary + thread id).
- Auto-investigation subscribes to incident-opened and runs the Investigator under SYSTEM_USER.
- UI layer `apps/hub/layers/uptime/`: `uptime.vue`, `ServiceCard`, `HistoryStrip`, `IncidentCard`, `ServiceDrawer`, `useUptime.ts` (polls every 10s; N+2 requests per tick via `/uptime/tools/*` gated routes).

## 7. Plugins / integrations

- One plugin = one vendor: `plugins/<id>/{index.ts (definePlugin), source.ts, fixture.ts, live.ts, tools.ts}`. Static list `PLUGINS`; ids also in `SOURCE_IDS` and `SourceOperationsById`.
- Modes `SOURCE_<ID>_MODE=fixture|live`; fixture default; live never falls back.
- Secrets: env vars in one gitignored root `.env`. OAuth hosted-MCP vendors (Noibu, Contentsquare) via `createHostedMcpSource()`; tokens in plaintext JSON via `FileOAuthStorage` under `.tokens/`; loopback redirect port per vendor (5533, 5534). Commercetools uses client credentials.
- Admin connect flow: `routes/hosted-mcp-auth.ts` (`POST|GET|DELETE /plugins/<id>/auth`, `/auth/test`, `/auth/disconnect`); hub `layers/plugins` opens a popup and polls. Assumes browser and Mastra host on the same machine.
- Patched `@mastra/mcp` passes RFC 9207 `iss` and fixes a callback-server close hang.
- Sharing: one process-wide adapter per plugin, authorised once, shared by all users and capabilities. Capability declares `requiresPlugins`.

## 8. Auth

- No real auth. Users hardcoded in `users.ts`; `SYSTEM_USER` absent from directory. User picker stores id in cookie `bb-hub-actor`. Every request carries `x-actor-id`. `middleware/actor-context.ts` resolves it and writes actor, roles, permissions, `mastra__resourceId` onto RequestContext. 401 unknown, 503 if grants unreadable. `createGatedTool` rejects identity-like input field names.

## 9. Stack

Nuxt 4.5.2, Nuxt UI 4.11.0, Vue 3.5.41, Tailwind 4.3.3, `@mastra/core` 1.63.0, mastra CLI 1.27.0, `@mastra/memory` 1.28.0, `@mastra/libsql` 1.22.0, `@mastra/mcp` 1.17.2 (patched), `@mastra/ai-sdk` 1.10.0, `ai` 7.0.83, `@ai-sdk/vue` 4.0.83, zod 4.4.3, TS 6.0.3 root / 5.9.3 packages, `@libsql/client` 0.17.4 raw SQL, vitest 4 + `@nuxt/test-utils` 4.3.3 + happy-dom, Node 20+ (local 24.22.1; tests need `NODE_OPTIONS=--no-webstorage` on Node 25). No Electron/Tauri. No deployment story.

## 10. Docs

`README.md` (most detailed), `apps/hub/layers/README.md` (layer conventions, read this when copying the architecture), `apps/mastra/src/mastra/plugins/README.md`, `apps/mastra/docs/chat-stream-contract.md`, `.ai-docs/digital-hub-overview.md`, `.ai-docs/plans/hub-modules-and-chat/overview.md` (vocabulary + decisions: linear ladders, Mastra is registry source of truth, one shared memory, no resumable streams, server-side read/run state, LibSQL for settings).

## Works well

- Server-owned per-actor registry: nav, chat rail, view gating, admin UI, Hub agent prompt from one answer.
- Typed ladder per capability validated at boot; roles only pick rungs; gates never look at roles.
- Gated-tool pipeline reused for agent tools and HTTP page reads, refusals as values.
- Vendor MCPs wrapped behind typed operations with fixture/live backends.
- Nuxt local layers per capability with lint-enforced boundaries and app-config merging. `uptime` is the template.
- Chat: AI SDK v7 SSE, one useChat per thread in a long-lived store, server-side run/read state.
- Boot-time manifest assertions.

## Awkward

- A capability has no single home: ~8 hand-maintained lists (`CAPABILITY_IDS`, `CAPABILITIES`, `SYSTEM_PERMISSIONS`, index.ts agents/workflows/apiRoutes, `CHAT_AGENT_IDS`, module manifest, hub layer + `LAYERS` lint list + `VIEW_ROUTES`). Plugins similar.
- Duplicated view→route knowledge (manifest `view.path` vs core `VIEW_ROUTES`).
- Mastra forbids custom routes under `/api`; actor middleware re-attached per route; gated/ungated twins.
- Browser calls Mastra cross-origin with spoofable header; CORS hardcoded; no BFF, no session.
- Raw SQL stores, no migrations, one shared SQLite file.
- In-process schedulers and globalThis singletons assume one process.
- Polling everywhere (threads 15s, uptime 10s, plugins 10s).
- Static tool attachment: model sees tools it cannot use.
- Plaintext tokens on disk; OAuth loopback cannot be hosted.
- Version fragility: patched `@mastra/mcp`, exact-pinned ai/ai-sdk-vue/mastra-ai-sdk trio, Node 25 happy-dom, TS 6 vs 5.9.
- Multi-module membership untested; uptime has no monitor CRUD (JSON file, restart to change).
