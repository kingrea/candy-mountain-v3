import type { CapabilityId, PlatformFactId, ProjectFactId } from './capabilities'
import type { ModuleId } from './modules'
import type { BotWriteScope } from './bots'
import type { AgentSessionFamily } from './sessions'

export const projectRegistryPath = (slug: string) => `/projects/${slug}/registry`

/** The web route of a project view; a manifest path of '' is the project home. */
export const projectViewRoute = (slug: string, path: string) => (path === '' ? `/p/${slug}` : `/p/${slug}/${path}`)

export interface RegistryNavEntry {
  /** The view id, or a fixed id in the system group. */
  id: string
  label: string
  icon: string
  /** Absolute web route. */
  to: string
}

export const REGISTRY_GROUP_KINDS = ['module', 'capability', 'system'] as const
export type RegistryGroupKind = (typeof REGISTRY_GROUP_KINDS)[number]

export interface RegistryNavGroup {
  /** The module id, the standalone capability id, or 'system'. */
  id: string
  label: string
  icon: string
  kind: RegistryGroupKind
  entries: RegistryNavEntry[]
  /** True for the admin when a member capability is not ready for the project; always false for other roles. */
  degraded: boolean
}

export const REGISTRY_SYSTEM_GROUP: RegistryNavGroup = {
  id: 'system',
  label: 'System',
  icon: 'i-lucide-settings',
  kind: 'system',
  entries: [
    { id: 'projects', label: 'Projects', icon: 'i-lucide-folder-git-2', to: '/projects' },
    { id: 'activity', label: 'Activity', icon: 'i-lucide-history', to: '/activity' },
    { id: 'settings', label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
  ],
  degraded: false,
}

export interface RegistryView {
  id: string
  capabilityId: CapabilityId
  label: string
  icon: string
  /** As declared in the manifest, relative to the project. */
  path: string
  /** Absolute web route. */
  to: string
  ready: boolean
}

export interface RegistryAgent {
  id: string
  capabilityId: CapabilityId
  label: string
  description: string
  family?: AgentSessionFamily
  avatar?: string
  /** Set for a project bot run from the console; its threads work in a worktree of their own, not the project checkout. */
  kind?: 'bot'
  bot?: RegistryAgentBot
}

export interface RegistryAgentBot {
  id: string
  writeScope: BotWriteScope
  /** Null means the repository's default branch. */
  baseBranch: string | null
}

export type ReadinessReason =
  | { kind: 'plugin', plugin: string, message: string }
  | { kind: 'plugin-any', plugins: string[], message: string }
  | { kind: 'project-fact', fact: ProjectFactId, message: string }
  | { kind: 'platform-fact', fact: PlatformFactId, message: string }

export interface RegistryCapability {
  id: CapabilityId
  label: string
  rung: string
  /** Whether the rung allows chatting with the capability's agents. */
  chat: boolean
  ready: boolean
  /** Why it is not ready; always empty for non-admins. */
  reasons: ReadinessReason[]
  /** The enabled modules it belongs to; empty for a standalone capability. */
  modules: ModuleId[]
  /** View ids the rung shows. */
  views: string[]
  /** Tool ids the rung grants. */
  tools: string[]
}

export interface DegradedModule {
  id: ModuleId
  label: string
  reasons: (ReadinessReason & { capabilityId: CapabilityId })[]
}

/** One answer for an actor and a project; the sidebar, chat rail, view gating and setup pages all read it. */
export interface RegistryResponse {
  project: { id: string, slug: string, name: string }
  admin: boolean
  /** Modules enabled for the project. */
  modules: ModuleId[]
  /** One per enabled module with something to show, then standalone capabilities, then the system group last. */
  groups: RegistryNavGroup[]
  /** Every view the actor's rung shows, ready or not. */
  views: RegistryView[]
  /** Agents the actor may chat with: the rung allows chat and the capability is ready. */
  agents: RegistryAgent[]
  /** Every granted capability that is a candidate for the project. */
  capabilities: RegistryCapability[]
  /** Admin only; empty for other roles. */
  degraded: DegradedModule[]
}

export const GATE_REFUSAL_CODES = ['capability_unknown', 'not_enabled', 'not_granted', 'not_ready'] as const
export type GateRefusalCode = (typeof GATE_REFUSAL_CODES)[number]
