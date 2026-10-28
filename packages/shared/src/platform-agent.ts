import type { CapabilityId } from './capabilities'
import type { GateRefusalCode } from './registry'

/** The registry agent id and the capability that contributes it. */
export const PLATFORM_AGENT_ID = 'platform'
export const PLATFORM_AGENT_CAPABILITY_ID: CapabilityId = 'platform-agent'

export const PLATFORM_AGENT_TOOL_IDS = ['open_view', 'start_chat', 'describe_platform'] as const
export type PlatformAgentToolId = (typeof PLATFORM_AGENT_TOOL_IDS)[number]

export const PLATFORM_CLIENT_ACTION_KINDS = ['navigate', 'open_thread'] as const
export type PlatformClientActionKind = (typeof PLATFORM_CLIENT_ACTION_KINDS)[number]

/** What the browser applies on the agent's behalf; the daemon never navigates or opens panels itself. */
export type PlatformClientAction =
  | { kind: 'navigate', to: string, projectSlug: string, viewId: string, capabilityId: CapabilityId }
  | { kind: 'open_thread', agentId: string, threadId?: string }

/** A tool answer the agent relays in words instead of acting on. */
export interface PlatformToolRefusal {
  refused: true
  code: GateRefusalCode | 'not_found' | 'invalid_request'
  reason: string
}

export interface PlatformToolAction {
  refused: false
  action: PlatformClientAction
  /** What the agent should tell the actor happens next. */
  summary: string
}

export type PlatformActionResult = PlatformToolAction | PlatformToolRefusal

export interface PlatformDescription {
  refused: false
  project: { slug: string, name: string }
  actor: { displayName: string, admin: boolean }
  modules: { id: string, label: string }[]
  views: { id: string, label: string, capabilityId: CapabilityId, to: string, ready: boolean }[]
  agents: { id: string, label: string, description: string }[]
  capabilities: { id: CapabilityId, label: string, rung: string, ready: boolean, reasons: string[] }[]
}

export type PlatformDescribeResult = PlatformDescription | PlatformToolRefusal
