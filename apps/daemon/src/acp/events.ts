import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  PermissionOption,
  RequestPermissionResponse,
  SessionUpdate,
  StopReason,
  ToolCall,
  ToolCallUpdate,
  Usage,
  UsageUpdate,
} from '@agentclientprotocol/sdk'

export const AGENT_FAMILIES = ['claude-code', 'codex'] as const
export type AgentFamily = (typeof AGENT_FAMILIES)[number]

export interface ExitInfo {
  code: number | null
  signal: NodeJS.Signals | null
}

export interface AcpEventBase {
  /** Starts at 1 per session and never repeats, so a consumer can order and deduplicate. */
  seq: number
  at: string
  sessionId: string
}

export type AcpEventPayload =
  | { kind: 'text', role: 'agent' | 'user', text: string }
  | { kind: 'reasoning', text: string }
  | { kind: 'tool_call', toolCall: ToolCall }
  /** Progress and results of a tool call, including its final status and content. */
  | { kind: 'tool_result', update: ToolCallUpdate }
  | { kind: 'usage', usage: UsageUpdate }
  /** Any session update without a kind of its own, verbatim, so nothing the agent says is lost. */
  | { kind: 'other', update: SessionUpdate }
  | { kind: 'permission_request', requestId: string, toolCall: ToolCallUpdate, options: PermissionOption[], respond: (response: RequestPermissionResponse) => boolean }
  | { kind: 'question', requestId: string, request: CreateElicitationRequest, respond: (response: CreateElicitationResponse) => boolean }
  /** A permission request or question that can no longer be answered because its turn ended. */
  | { kind: 'request_cancelled', requestId: string }
  | { kind: 'turn_end', stopReason: StopReason, usage: Usage | null }
  | { kind: 'error', phase: 'prompt' | 'cancel' | 'connection', message: string, code: number | null }
  | { kind: 'auth_required', message: string }
  | { kind: 'exited', code: number | null, signal: NodeJS.Signals | null, expected: boolean }

export type AcpSessionEvent = AcpEventBase & AcpEventPayload
export type AcpEventKind = AcpSessionEvent['kind']
export type AcpEventListener = (event: AcpSessionEvent) => void

export function isAgentFamily(value: unknown): value is AgentFamily {
  return typeof value === 'string' && (AGENT_FAMILIES as readonly string[]).includes(value)
}
