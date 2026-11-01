import type { ChatThread, ChatThreadSession, CreateChatThreadRequest, RegistryAgent, UpdateChatThreadRequest } from '@candy-mountain/shared'
import { markRaw, type Component, type Ref } from 'vue'

/** What a draft thread is created with besides its agent; a piece fills in its own fields before the first prompt. */
export type ChatFamilyDraft = Omit<CreateChatThreadRequest, 'agentId'>

/** The thread on screen, as the agent panel hands it to a family's pieces in their `thread` prop. */
export interface ChatFamilyThread {
  slug: Readonly<Ref<string | null>>
  agentId: Readonly<Ref<string>>
  /** The registry's entry for the agent, once the registry lists it. */
  agent: Readonly<Ref<RegistryAgent | null>>
  /** Null while the thread is a draft that the first prompt creates. */
  threadId: Readonly<Ref<string | null>>
  thread: Readonly<Ref<ChatThread | null>>
  /** Every session the thread has wrapped, oldest first; empty for a draft. */
  sessions: Readonly<Ref<readonly ChatThreadSession[]>>
  working: Readonly<Ref<boolean>>
  /** What the draft is created with so far; cleared when the thread or agent changes. */
  draft: Readonly<Ref<ChatFamilyDraft>>
  setDraft: (fields: ChatFamilyDraft) => void
  /** Transcript divider text keyed by session id, shown above a session that replaced an earlier one; cleared when the thread or agent changes. */
  setSessionDividers: (labels: Record<string, string>) => void
  /** Changes an existing thread; when the change starts a new session, the replaced session's log stays on screen. Rejects as the API does. */
  update: (body: UpdateChatThreadRequest) => Promise<void>
  /** Re-reads the thread, its sessions and the thread list. */
  refresh: () => Promise<void>
}

/** Components a layer adds to every thread of one family; each receives the thread as its `thread` prop. */
export interface ChatFamilyPieces {
  /** Unique across layers, usually the contributing layer's id; registering it again replaces the earlier pieces. */
  id: string
  /** Between the panel header and the transcript. */
  aboveTranscript?: Component
  /** In the prompt bar's footer. */
  promptBar?: Component
}

export type ChatFamilySlot = Exclude<keyof ChatFamilyPieces, 'id'>

const registered = new Map<string, Map<string, ChatFamilyPieces>>()

/**
 * The registration point for family-specific pieces: call it from a Nuxt plugin in the layer that owns the family,
 * since the chat layer never imports a capability. Several layers may contribute to one family; they render in
 * registration order.
 */
export function chatFamilyRegister(family: string, pieces: ChatFamilyPieces): void {
  const entry: ChatFamilyPieces = { id: pieces.id }
  if (pieces.aboveTranscript) entry.aboveTranscript = markRaw(pieces.aboveTranscript)
  if (pieces.promptBar) entry.promptBar = markRaw(pieces.promptBar)
  const families = registered.get(family) ?? new Map<string, ChatFamilyPieces>()
  families.set(pieces.id, entry)
  registered.set(family, families)
}

export function chatFamilyPieces(family: string | null | undefined): ChatFamilyPieces[] {
  return family ? [...(registered.get(family)?.values() ?? [])] : []
}

/** The components registered for one slot of a family, in registration order. */
export function chatFamilyComponents(family: string | null | undefined, slot: ChatFamilySlot): Component[] {
  return chatFamilyPieces(family).flatMap(pieces => (pieces[slot] ? [pieces[slot]] : []))
}
