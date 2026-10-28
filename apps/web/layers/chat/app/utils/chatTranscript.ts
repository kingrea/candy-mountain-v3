import type { AcpObject, AgentSessionEvent, Decision, PlatformClientAction } from '@candy-mountain/shared'
import { chatIsClientAction } from './chatClientActions'

/** Starts a session's rows: seqs and tool call ids restart after it, and item keys take its key. A null label shows nothing. */
export interface ChatTranscriptDivider {
  kind: 'divider'
  key: string
  label: string | null
}

/** One session's log, with the divider text shown above it when it replaced an earlier session. */
export interface ChatTranscriptSession {
  id: string
  divider: string | null
  events: readonly AgentSessionEvent[]
}

export type ChatTranscriptRow = AgentSessionEvent | ChatTranscriptDivider

export const CHAT_TOOL_STATUSES = ['pending', 'in_progress', 'completed', 'failed'] as const
export type ChatToolStatus = (typeof CHAT_TOOL_STATUSES)[number]

export type ChatToolOutput =
  | { type: 'text', text: string }
  | { type: 'diff', path: string, oldText: string | null, newText: string }
  | { type: 'other', label: string }

export interface ChatTranscriptTokens {
  input: number | null
  output: number | null
  total: number | null
  thought: number | null
  cachedRead: number | null
  cachedWrite: number | null
}

interface ChatItemBase {
  key: string
  seq: number
  at: string
}

export interface ChatPromptItem extends ChatItemBase { kind: 'prompt', text: string }
export interface ChatTextItem extends ChatItemBase { kind: 'text', text: string }
export interface ChatReasoningItem extends ChatItemBase {
  kind: 'reasoning'
  text: string
  /** When the next row arrived; null while it may still grow. */
  endedAt: string | null
}
export interface ChatToolItem extends ChatItemBase {
  kind: 'tool'
  toolCallId: string
  title: string
  toolKind: string | null
  status: ChatToolStatus
  /** Pending or in progress and its turn has not ended. */
  running: boolean
  input: unknown
  output: ChatToolOutput[]
  rawOutput: unknown
  locations: string[]
}
/** What the agent reported for one turn: tokens from the turn's end, context and cost from its latest usage update. */
export interface ChatTranscriptUsage {
  tokens: ChatTranscriptTokens | null
  context: { used: number, size: number } | null
  cost: { amount: number, currency: string } | null
}
export interface ChatDecisionItem extends ChatItemBase { kind: 'decision', decision: Decision }
export interface ChatErrorItem extends ChatItemBase { kind: 'error', title: string, message: string }
export interface ChatTurnItem extends ChatItemBase { kind: 'turn', stopReason: string, usage: ChatTranscriptUsage | null }
export interface ChatActionItem extends ChatItemBase {
  kind: 'action'
  /** The divider key of the session it came from (empty before any divider), since tool call ids only repeat across sessions. */
  session: string
  toolCallId: string
  action: PlatformClientAction
}
export interface ChatDividerItem { kind: 'divider', key: string, label: string }

export type ChatTranscriptItem =
  | ChatPromptItem
  | ChatTextItem
  | ChatReasoningItem
  | ChatToolItem
  | ChatDecisionItem
  | ChatErrorItem
  | ChatTurnItem
  | ChatActionItem
  | ChatDividerItem

const ERROR_TITLES: Record<Extract<AgentSessionEvent, { kind: 'error' }>['phase'], string> = {
  start: 'The agent could not start',
  prompt: 'The turn failed',
  cancel: 'Cancelling failed',
  connection: 'Lost the connection to the agent',
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

function toolOutput(content: unknown): ChatToolOutput[] | null {
  if (!Array.isArray(content)) return null
  return content.flatMap((part): ChatToolOutput[] => {
    if (!isRecord(part)) return []
    if (part.type === 'content' && isRecord(part.content)) {
      const block = part.content
      if (block.type === 'text' && typeof block.text === 'string') return [{ type: 'text', text: block.text }]
      return [{ type: 'other', label: `${String(block.type ?? 'unknown')} content` }]
    }
    if (part.type === 'diff' && typeof part.path === 'string') {
      return [{ type: 'diff', path: part.path, oldText: typeof part.oldText === 'string' ? part.oldText : null, newText: typeof part.newText === 'string' ? part.newText : '' }]
    }
    if (part.type === 'terminal') return [{ type: 'other', label: 'Terminal output' }]
    return []
  })
}

function applyToolFields(item: ChatToolItem, fields: AcpObject) {
  const title = stringOrNull(fields.title)
  if (title) item.title = title
  const kind = stringOrNull(fields.kind)
  if (kind) item.toolKind = kind
  if ((CHAT_TOOL_STATUSES as readonly unknown[]).includes(fields.status)) item.status = fields.status as ChatToolStatus
  if (fields.rawInput !== undefined) item.input = fields.rawInput
  if (fields.rawOutput !== undefined) item.rawOutput = fields.rawOutput
  const output = toolOutput(fields.content)
  if (output) item.output = output
  if (Array.isArray(fields.locations)) {
    item.locations = fields.locations.flatMap(location => (isRecord(location) && typeof location.path === 'string' ? [location.path] : []))
  }
  item.running = item.status === 'pending' || item.status === 'in_progress'
}

function tokensOf(usage: AcpObject | null): ChatTranscriptTokens | null {
  if (!usage) return null
  const tokens: ChatTranscriptTokens = {
    input: numberOrNull(usage.inputTokens),
    output: numberOrNull(usage.outputTokens),
    total: numberOrNull(usage.totalTokens),
    thought: numberOrNull(usage.thoughtTokens),
    cachedRead: numberOrNull(usage.cachedReadTokens),
    cachedWrite: numberOrNull(usage.cachedWriteTokens),
  }
  return Object.values(tokens).some(value => value !== null) ? tokens : null
}

export const CHAT_TRANSCRIPT_CURRENT = 'current'

/** Earlier sessions oldest first, then the current one, as one row list; keys stay put as earlier sessions load in. */
export function chatTranscriptRows(sessions: readonly ChatTranscriptSession[]): ChatTranscriptRow[] {
  return sessions.flatMap((session): ChatTranscriptRow[] => [{ kind: 'divider', key: session.id, label: session.divider }, ...session.events])
}

/**
 * Folds session log rows into what the transcript shows: streamed chunks joined, each tool call one item updated by its
 * results, decisions carrying their latest state, usage gathered onto each turn's end. Rows the transcript does not show are dropped.
 */
export function chatSegmentTranscript(rows: readonly ChatTranscriptRow[]): ChatTranscriptItem[] {
  const items: ChatTranscriptItem[] = []
  let prefix = ''
  let tools = new Map<string, ChatToolItem>()
  const decisions = new Map<string, ChatDecisionItem>()
  let joinable: ChatPromptItem | ChatTextItem | ChatReasoningItem | null = null
  let context: ChatTranscriptUsage['context'] = null
  let cost: ChatTranscriptUsage['cost'] = null

  const keyOf = (seq: number) => (prefix ? `${prefix}:${seq}` : String(seq))

  function push(item: ChatTranscriptItem) {
    const last = items.at(-1)
    if (last?.kind === 'reasoning' && last.endedAt === null && item.kind !== 'divider') last.endedAt = item.at
    items.push(item)
    joinable = null
  }

  function settleTurn() {
    for (const tool of tools.values()) tool.running = false
    context = null
    cost = null
  }

  function tool(id: string, row: AgentSessionEvent): ChatToolItem {
    const existing = tools.get(id)
    if (existing) return existing
    const created: ChatToolItem = {
      kind: 'tool', key: keyOf(row.seq), seq: row.seq, at: row.at, toolCallId: id, title: 'Tool call', toolKind: null,
      status: 'pending', running: true, input: undefined, output: [], rawOutput: undefined, locations: [],
    }
    tools.set(id, created)
    push(created)
    return created
  }

  for (const row of rows) {
    if (row.kind === 'divider') {
      settleTurn()
      prefix = row.key
      tools = new Map()
      if (row.label !== null) push({ kind: 'divider', key: `${row.key}:divider`, label: row.label })
      else joinable = null
      continue
    }
    const base = { key: keyOf(row.seq), seq: row.seq, at: row.at }
    switch (row.kind) {
      case 'prompt':
        push({ kind: 'prompt', ...base, text: row.text })
        break
      case 'text':
      case 'reasoning': {
        const kind = row.kind === 'reasoning' ? 'reasoning' : row.role === 'user' ? 'prompt' : 'text'
        const open = joinable as ChatPromptItem | ChatTextItem | ChatReasoningItem | null
        if (open?.kind === kind) {
          open.text += row.text
          break
        }
        const item: ChatPromptItem | ChatTextItem | ChatReasoningItem = kind === 'reasoning'
          ? { kind, ...base, text: row.text, endedAt: null }
          : { kind, ...base, text: row.text }
        push(item)
        joinable = item
        break
      }
      case 'tool_call':
      case 'tool_result': {
        const fields = row.kind === 'tool_call' ? row.toolCall : row.update
        const id = stringOrNull(fields.toolCallId)
        if (!id) break
        applyToolFields(tool(id, row), fields)
        break
      }
      case 'usage': {
        const used = numberOrNull(row.usage.used)
        const size = numberOrNull(row.usage.size)
        if (used !== null && size !== null) context = { used, size }
        const reported = isRecord(row.usage.cost) ? row.usage.cost : null
        const amount = numberOrNull(reported?.amount)
        if (amount !== null) cost = { amount, currency: stringOrNull(reported?.currency) ?? 'USD' }
        break
      }
      case 'decision_opened': {
        const item: ChatDecisionItem = { kind: 'decision', ...base, decision: row.decision }
        decisions.set(row.decision.id, item)
        push(item)
        break
      }
      case 'decision_answered': {
        const item = decisions.get(row.decisionId)
        if (item) item.decision = { ...item.decision, state: 'answered', answer: row.answer }
        break
      }
      case 'decision_expired': {
        const item = decisions.get(row.decisionId)
        if (item) item.decision = { ...item.decision, state: 'expired', expiry: row.expiry }
        break
      }
      case 'turn_end': {
        const tokens = tokensOf(row.usage)
        const usage = tokens || context || cost ? { tokens, context, cost } : null
        settleTurn()
        push({ kind: 'turn', ...base, stopReason: row.stopReason, usage })
        break
      }
      case 'error':
        push({ kind: 'error', ...base, title: ERROR_TITLES[row.phase] ?? 'Something went wrong', message: row.message })
        break
      case 'auth_required':
        settleTurn()
        push({ kind: 'error', ...base, title: 'The agent is not logged in', message: row.message })
        break
      case 'client_action':
        if (chatIsClientAction(row.action)) push({ kind: 'action', ...base, session: prefix, toolCallId: row.toolCallId, action: row.action })
        break
      case 'exited':
        settleTurn()
        if (!row.expected) {
          const how = row.signal ? `signal ${row.signal}` : `exit code ${row.code ?? 'unknown'}`
          push({ kind: 'error', ...base, title: 'The agent stopped unexpectedly', message: `The agent process ended (${how}).` })
        }
        break
      default:
        // permission_request, question and request_cancelled are shown through their decision rows; `other` is agent housekeeping.
        break
    }
  }
  return items
}

/** The decision's own copy of the tool call it gates, read defensively since ACP objects are carried verbatim. */
export function chatDecisionTool(decision: Decision): { title: string, kind: string | null, input: unknown, notes: string[], locations: string[] } {
  const call = decision.toolCall ?? {}
  return {
    title: stringOrNull(call.title) ?? 'Tool call',
    kind: stringOrNull(call.kind),
    input: call.rawInput,
    notes: (toolOutput(call.content) ?? []).flatMap(part => (part.type === 'text' ? [part.text] : [])),
    locations: Array.isArray(call.locations) ? call.locations.flatMap(location => (isRecord(location) && typeof location.path === 'string' ? [location.path] : [])) : [],
  }
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

export function chatUsageParts(usage: ChatTranscriptUsage): string[] {
  const parts: string[] = []
  const { tokens, context, cost } = usage
  if (tokens) {
    if (tokens.input !== null) parts.push(`${compact.format(tokens.input)} in`)
    if (tokens.output !== null) parts.push(`${compact.format(tokens.output)} out`)
    if (!parts.length && tokens.total !== null) parts.push(`${compact.format(tokens.total)} tokens`)
    if (tokens.thought) parts.push(`${compact.format(tokens.thought)} thinking`)
  }
  if (context) parts.push(`${compact.format(context.used)} / ${compact.format(context.size)} context`)
  if (cost) parts.push(money(cost.amount, cost.currency))
  return parts
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 4 }).format(amount)
  }
  catch {
    return `${amount} ${currency}`
  }
}

const STOP_REASONS: Record<string, string> = {
  end_turn: 'Done',
  cancelled: 'Cancelled',
  max_tokens: 'Stopped: the token limit was reached',
  max_turn_requests: 'Stopped: too many model requests in one turn',
  refusal: 'The agent refused to continue',
}

export function chatStopReasonLabel(stopReason: string): string {
  return STOP_REASONS[stopReason] ?? `Stopped (${stopReason})`
}
