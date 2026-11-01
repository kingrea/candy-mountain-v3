import type { PluginTypeId } from './plugins'
import type { AgentSessionFamily } from './sessions'

// Capability, module, plugin type, session family and activity event ids are open strings: the daemon checks
// them against what it registers at boot, so adding a capability never edits this package.
export type CapabilityId = string

/** Every ladder starts with this rung, and it grants nothing. */
export const NONE_RUNG = 'none'

/** Ids of capabilities, modules, views, agents, jobs, tools, rungs, plugin types, session families and activity event types. */
export const MANIFEST_ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/

/** Lowercase segments joined by '/', no leading or trailing slash; '' is the project home. */
export const VIEW_PATH_PATTERN = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/

/** Facts about a project a capability may require; the first three match `PathVerification`. */
export const PROJECT_FACT_IDS = ['hasBeads', 'isGitRepo', 'hasRemote', 'hasBots'] as const
export type ProjectFactId = (typeof PROJECT_FACT_IDS)[number]

/** Platform-wide facts a capability may require, the same for every project. */
export const PLATFORM_FACT_IDS = ['llmGateway'] as const
export type PlatformFactId = (typeof PLATFORM_FACT_IDS)[number]

export interface ViewManifest<V extends string = string> {
  id: V
  label: string
  /** Iconify name, e.g. 'i-lucide-list-todo'. */
  icon: string
  /** Relative to the selected project's base route. */
  path: string
}

export interface AgentManifest {
  id: string
  label: string
  description: string
  /** The session family a chat thread with this agent runs on. */
  family?: AgentSessionFamily
  /** Iconify name shown in the chat rail. */
  avatar?: string
}

export interface JobManifest {
  id: string
  label: string
  description: string
}

export const TOOL_KINDS = ['tool', 'operation'] as const
/** 'tool' is called by an agent; 'operation' is an HTTP route action gated in its handler. */
export type ToolKind = (typeof TOOL_KINDS)[number]

export interface ToolScopeManifest {
  dimension: string
  /** Ascending: the last level is the widest. */
  levels: readonly string[]
}

export interface ToolManifest<T extends string = string> {
  id: T
  kind: ToolKind
  scope?: ToolScopeManifest
}

export interface ToolPermission {
  /** Widest level granted; required exactly when the tool declares a scope. */
  scope?: string
}

export interface Rung<V extends string = string, T extends string = string, R extends string = string> {
  name: R
  label: string
  description: string
  views: readonly V[]
  /** Whether the capability's agents may be chatted with. */
  chat: boolean
  /** A tool absent here may not be called on this rung. */
  tools: { readonly [K in T]?: ToolPermission }
}

export interface CapabilityManifest<V extends string = string, T extends string = string, R extends string = string> {
  id: CapabilityId
  label: string
  description: string
  views: readonly ViewManifest<V>[]
  agents: readonly AgentManifest[]
  /** The registry adds agents from project data (the project's bots), so a chat rung needs no declared agent. */
  projectAgents?: boolean
  jobs: readonly JobManifest[]
  /** Plugin type ids; the capability is degraded in a project until each has a healthy instance. */
  requiresPlugins: readonly string[]
  /** Each group is satisfied by a healthy instance of any one of its plugin types. */
  requiresAnyPlugins?: readonly (readonly PluginTypeId[])[]
  /** Verification facts the project must have before the capability is ready. */
  requiresProjectFacts?: readonly ProjectFactId[]
  /** Platform settings that must be in place before the capability is ready anywhere. */
  requiresPlatformFacts?: readonly PlatformFactId[]
  tools: readonly ToolManifest<T>[]
  /** Ascending from 'none'; each rung grants at least what the one below does. */
  ladder: readonly Rung<V, T, R>[]
  /** A rung every signed-in actor holds without a grant; grants can only raise it. */
  everyoneRung?: R
}

export type AnyCapabilityManifest = CapabilityManifest
