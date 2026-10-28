import type { RouteLocationRaw } from 'vue-router'

/** `?thread=<id>` on any project page opens that thread in the panel on load. */
export const CHAT_THREAD_QUERY = 'thread'

export const CHAT_THREADS_POLL_MS = 15_000

/** The deep link to a thread: the current page by default, or a project page such as `projectPath(slug)`. */
export function chatThreadLink(threadId: string, path?: string): RouteLocationRaw {
  return path ? { path, query: { [CHAT_THREAD_QUERY]: threadId } } : { query: { [CHAT_THREAD_QUERY]: threadId } }
}

export const chatThreadsDataKey = (slug: string | null | undefined) => `chat-threads:${slug ?? ''}`
export const chatThreadDataKey = (slug: string | null | undefined, threadId: string | null | undefined) => `chat-thread:${slug ?? ''}:${threadId ?? ''}`
export const chatAgentOptionsDataKey = (slug: string | null | undefined, agentId: string | null | undefined) => `chat-agent-options:${slug ?? ''}:${agentId ?? ''}`
