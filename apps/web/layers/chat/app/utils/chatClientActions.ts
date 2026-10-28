import {
  PLATFORM_AGENT_ID,
  PLATFORM_CLIENT_ACTION_KINDS,
  type AgentSessionEvent,
  type PlatformClientAction,
  type RegistryResponse,
} from '@candy-mountain/shared'

/** `earlier` is an action from before this tab followed the session: someone else's past, never re-applied. */
export const CHAT_ACTION_STATES = ['applying', 'applied', 'failed', 'earlier', 'ignored'] as const
export type ChatActionState = (typeof CHAT_ACTION_STATES)[number]

export type ChatActionOutcome = { state: 'applying' | 'applied' } | { state: 'failed', message: string }

/** What one tab did with one session's actions. */
export interface ChatActionLedger {
  /** The session's last activity when this tab first followed it; rows up to then are replay, not requests. */
  since: string
  outcomes: Record<string, ChatActionOutcome>
}

export interface ChatPendingAction {
  toolCallId: string
  action: PlatformClientAction
}

export const chatActionsApply = (agentId: string | null | undefined) => agentId === PLATFORM_AGENT_ID

export function chatIsClientAction(value: unknown): value is PlatformClientAction {
  return typeof value === 'object' && value !== null && (PLATFORM_CLIENT_ACTION_KINDS as readonly unknown[]).includes((value as { kind?: unknown }).kind)
}

export function chatActionLedger(session: { lastActivityAt: string }): ChatActionLedger {
  return { since: session.lastActivityAt, outcomes: {} }
}

/** Actions to apply now: platform thread only, newer than the ledger's start, once per tool call. */
export function chatActionsToApply(rows: readonly AgentSessionEvent[], ledger: ChatActionLedger | undefined, agentId: string | null | undefined): ChatPendingAction[] {
  if (!ledger || !chatActionsApply(agentId)) return []
  const since = Date.parse(ledger.since)
  const taken = new Set(Object.keys(ledger.outcomes))
  const pending: ChatPendingAction[] = []
  for (const row of rows) {
    if (row.kind !== 'client_action' || taken.has(row.toolCallId) || !chatIsClientAction(row.action)) continue
    if (!(Date.parse(row.at) > since)) continue
    taken.add(row.toolCallId)
    pending.push({ toolCallId: row.toolCallId, action: row.action })
  }
  return pending
}

export function chatActionState(toolCallId: string, ledger: ChatActionLedger | undefined, applies: boolean): ChatActionState {
  if (!applies) return 'ignored'
  return ledger?.outcomes[toolCallId]?.state ?? 'earlier'
}

/** The registry's own route for the view when it describes the same project, so the sidebar and the action agree. */
export function chatNavigatePath(action: Extract<PlatformClientAction, { kind: 'navigate' }>, registry: RegistryResponse | null): string {
  if (registry?.project.slug !== action.projectSlug) return action.to
  return registry.views.find(view => view.id === action.viewId)?.to ?? action.to
}

function navigateTarget(action: Extract<PlatformClientAction, { kind: 'navigate' }>, registry: RegistryResponse | null): string {
  const sameProject = registry?.project.slug === action.projectSlug
  const view = sameProject ? registry.views.find(candidate => candidate.id === action.viewId)?.label : undefined
  return `${view ?? action.viewId} for ${sameProject ? registry.project.name : action.projectSlug}`
}

const VERBS: Record<PlatformClientAction['kind'], Record<ChatActionState, string>> = {
  navigate: { applying: 'Opening', applied: 'Opened', earlier: 'Opened', failed: 'Could not open', ignored: 'Did not open' },
  open_thread: { applying: 'Starting', applied: 'Started', earlier: 'Started', failed: 'Could not start', ignored: 'Did not start' },
}

export function chatActionLabel(action: PlatformClientAction, state: ChatActionState, registry: RegistryResponse | null): string {
  const verb = VERBS[action.kind][state]
  if (action.kind === 'navigate') return `${verb} ${navigateTarget(action, registry)}`
  const agent = registry?.agents.find(candidate => candidate.id === action.agentId)?.label ?? action.agentId
  return `${verb} a chat with ${agent}`
}
