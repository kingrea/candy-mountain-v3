import type { ChatThread, RegistryAgent } from '@candy-mountain/shared'
import type { Component, MaybeRefOrGetter } from 'vue'

export const CHAT_DEFAULT_AVATAR = 'i-lucide-bot'

export interface ChatRailEntry {
  /** Unique across sources: agent entries use the registry agent id, other sources namespace theirs (`bot:<id>`). */
  id: string
  label: string
  description?: string
  /** Iconify name. */
  avatar: string
  unread?: boolean
  working?: boolean
  /** The registry agent whose threads the default panel lists and prompts; absent for entries with their own panel. */
  agentId?: string
  /** Replaces the default panel body for this entry; receives the entry as its `entry` prop (wrap in markRaw). */
  panel?: Component
}

export interface ChatRailSource {
  id: string
  /** Runs once inside the rail's setup, so it may call composables; the entries react like any ref. */
  use: () => MaybeRefOrGetter<ChatRailEntry[]>
  /** Lower first; the registry's agents are 0. */
  order?: number
}

const sources = new Map<string, ChatRailSource>()

/**
 * The registration point for entries that are not registry agents: call it from a Nuxt plugin in the contributing
 * layer, since the chat layer never imports a capability. Such entries bring their own `panel`.
 */
export function chatRailRegister(source: ChatRailSource): void {
  sources.set(source.id, source)
}

export function chatRailSources(): ChatRailSource[] {
  return [...sources.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

export function chatAgentRailEntries(agents: RegistryAgent[], threads: ChatThread[]): ChatRailEntry[] {
  return agents.map(agent => ({
    id: agent.id,
    label: agent.label,
    description: agent.description,
    avatar: agent.avatar ?? CHAT_DEFAULT_AVATAR,
    unread: threads.some(thread => thread.agentId === agent.id && thread.unread),
    working: threads.some(thread => thread.agentId === agent.id && thread.working),
    agentId: agent.id,
  }))
}
