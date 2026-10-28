import type { AcpObject, AgentSessionEvent } from '@candy-mountain/shared'
import { SlackApiError, type SlackClient } from '../plugins/slack'
import { SLACK_TEXT_MAX, splitSlackText } from './post'

export type SlackProgressMode = 'stream' | 'message'

export interface SlackTurnMessage {
  channel: string
  threadTs: string
  ts: string
  mode: SlackProgressMode
}

export interface SlackProgressTarget {
  channel: string
  threadTs: string
  /** A native stream is addressed to the member whose message started the turn. */
  recipientUserId: string
  recipientTeamId: string | null
}

export interface SlackProgressOptions {
  /** Shortest gap between two Slack calls for the same turn. */
  intervalMs: number
  /** Try chat.startStream first; false goes straight to one message edited in place. */
  native: boolean
  /** The message the turn already lives in, after a restart. */
  message?: SlackTurnMessage | null
  /** When that message's stream started, if known; no later than the real start. */
  openedAt?: number | null
  /** Log rows up to this seq are already in Slack; later rows of `history` are still to send. */
  sentSeq?: number
  history?: AgentSessionEvent[]
  now?: () => number
  signal?: AbortSignal
  log?: Pick<Console, 'error'>
  /** The turn's message was posted, or moved from a stream to edits of the same message. */
  onMessage?(message: SlackTurnMessage): void
  onSent?(seq: number): void
  onNativeRefused?(): void
}

export interface SlackProgress {
  push(event: AgentSessionEvent): void
  /** Sends what is left and ends the message; null when nothing was posted and there was nothing to say. */
  finish(note?: string | null): Promise<SlackTurnMessage | null>
  /** Stops the timers without a Slack call, so a restart can pick the turn up. */
  abandon(): void
  readonly message: SlackTurnMessage | null
  readonly text: string
}

type TaskStatus = 'in_progress' | 'complete' | 'error'
interface Task { id: string, title: string, status: TaskStatus }
type Chunk = { type: 'markdown_text', text: string } | { type: 'task_update', id: string, title: string, status: TaskStatus }

/** Slack caps a stream's markdown at 12,000 characters in total, across every call. */
export const SLACK_STREAM_TEXT_MAX = 11_500
/** Slack ends a stream 10 minutes after chat.startStream, however busy it is. */
export const SLACK_STREAM_MAX_AGE_MS = 9 * 60_000
const TIMELINE_MAX_LINES = 30
const MARK: Record<TaskStatus, string> = { in_progress: '…', complete: '✓', error: '✗' }

// chat.postMessage fails the same way, so these say nothing about whether the workspace can stream.
const NOT_ABOUT_STREAMING = new Set(['channel_not_found', 'not_in_channel', 'is_archived', 'invalid_auth', 'not_authed', 'token_revoked', 'token_expired', 'account_inactive'])

const slackError = (error: unknown) => (error instanceof SlackApiError && error.code === 'slack_error' ? error.slackError ?? null : null)

const taskStatus = (status: unknown): TaskStatus => (status === 'completed' ? 'complete' : status === 'failed' ? 'error' : 'in_progress')

const textLength = (chunks: Chunk[]) => chunks.reduce((sum, chunk) => sum + (chunk.type === 'markdown_text' ? chunk.text.length : 0), 0)

export function summariseToolCall(toolCall: AcpObject): string {
  const title = typeof toolCall.title === 'string' ? toolCall.title.replace(/\s+/g, ' ').trim() : ''
  if (!title) return 'Tool'
  return title.length > 120 ? `${title.slice(0, 119)}…` : title
}

export function progressChunk(event: AgentSessionEvent, titles: Map<string, string>): Chunk | null {
  if (event.kind === 'text') return event.role === 'agent' && event.text ? { type: 'markdown_text', text: event.text } : null
  if (event.kind !== 'tool_call' && event.kind !== 'tool_result') return null
  const call = event.kind === 'tool_call' ? event.toolCall : event.update
  if (typeof call.toolCallId !== 'string') return null
  const title = event.kind === 'tool_call' || typeof call.title === 'string' ? summariseToolCall(call) : titles.get(call.toolCallId) ?? 'Tool'
  return { type: 'task_update', id: call.toolCallId, title, status: taskStatus(call.status) }
}

/** A stream that hits Slack's age or length cap carries on as edits of the same message, so a turn never gets a second one. */
export function createSlackProgress(client: SlackClient, target: SlackProgressTarget, options: SlackProgressOptions): SlackProgress {
  const { intervalMs, signal, now = Date.now, log = console } = options
  let native = options.native
  let message = options.message ?? null
  let openedAt = options.openedAt ?? null
  let sentSeq = options.sentSeq ?? 0
  let text = ''
  let streamed = 0
  // The member pressed stop on the stream; the turn goes on without Slack.
  let muted = false
  const tasks = new Map<string, Task>()
  let pending: Chunk[] = []
  let pendingSeq = sentSeq
  let timer: NodeJS.Timeout | null = null
  let chain = Promise.resolve()
  let finished = false

  function apply(chunk: Chunk): void {
    if (chunk.type === 'markdown_text') text += chunk.text
    else tasks.set(chunk.id, { id: chunk.id, title: chunk.title, status: chunk.status })
  }

  function queue(chunk: Chunk): void {
    const last = pending.at(-1)
    if (chunk.type === 'markdown_text' && last?.type === 'markdown_text') {
      last.text += chunk.text
      return
    }
    const index = chunk.type === 'task_update' ? pending.findIndex(p => p.type === 'task_update' && p.id === chunk.id) : -1
    if (index >= 0) pending[index] = chunk
    else pending.push(chunk)
  }

  function take(event: AgentSessionEvent, alreadySent: boolean): void {
    const chunk = progressChunk(event, new Map([...tasks].map(([id, task]) => [id, task.title])))
    if (!chunk) return
    apply(chunk)
    if (alreadySent) {
      if (message?.mode === 'stream') streamed += textLength([chunk])
      return
    }
    queue(chunk)
    pendingSeq = event.seq
  }

  for (const event of options.history ?? []) take(event, event.seq <= sentSeq)

  function timeline(): string[] {
    const lines = [...tasks.values()].map(task => `${MARK[task.status]} ${task.title}`)
    return lines.length > TIMELINE_MAX_LINES ? [`(${lines.length - TIMELINE_MAX_LINES} earlier steps)`, ...lines.slice(-TIMELINE_MAX_LINES)] : lines
  }

  function render(working: boolean, note: string | null): string {
    const head = timeline().join('\n')
    const tail = [note, working ? '_Working…_' : null].filter(Boolean).join('\n\n')
    const body = text.trim()
    const frame = (content: string) => [head, content, tail].filter(Boolean).join('\n\n')
    const full = frame(body)
    if (!working || full.length <= SLACK_TEXT_MAX) return full
    const room = Math.max(0, SLACK_TEXT_MAX - frame('…').length)
    return frame(`…${body.slice(-room)}`)
  }

  const thread = { channel: target.channel, thread_ts: target.threadTs }

  function remember(ts: unknown, mode: SlackProgressMode): SlackTurnMessage {
    message = { channel: target.channel, threadTs: target.threadTs, ts: String(ts), mode }
    options.onMessage?.(message)
    return message
  }

  async function open(chunks: Chunk[]): Promise<void> {
    if (native && textLength(chunks) <= SLACK_STREAM_TEXT_MAX) {
      try {
        const recipient = { recipient_user_id: target.recipientUserId, ...(target.recipientTeamId ? { recipient_team_id: target.recipientTeamId } : {}) }
        const result = await client.call<{ ts?: unknown }>('chat.startStream', { ...thread, ...recipient, chunks })
        openedAt = now()
        streamed = textLength(chunks)
        remember(result.ts, 'stream')
        return
      }
      catch (error) {
        // Slack answered, so it is this app or workspace that cannot stream; transport failures are retried as they are.
        const code = slackError(error)
        if (code === null || NOT_ABOUT_STREAMING.has(code)) throw error
        native = false
        options.onNativeRefused?.()
      }
    }
    const result = await client.call<{ ts?: unknown }>('chat.postMessage', { ...thread, text: render(true, null) })
    remember(result.ts, 'message')
  }

  async function leaveStream(stop: boolean): Promise<void> {
    if (stop) {
      try {
        await client.call('chat.stopStream', { channel: message!.channel, ts: message!.ts })
      }
      catch (error) {
        if (slackError(error) !== 'message_not_in_streaming_state') throw error
      }
    }
    remember(message!.ts, 'message')
  }

  /** False when the stream is over and the caller should edit the message instead. */
  async function stream(method: 'chat.appendStream' | 'chat.stopStream', chunks: Chunk[]): Promise<boolean> {
    if (muted) return true
    const length = textLength(chunks)
    if ((openedAt !== null && now() - openedAt >= SLACK_STREAM_MAX_AGE_MS) || streamed + length > SLACK_STREAM_TEXT_MAX) {
      await leaveStream(true)
      return false
    }
    try {
      await client.call(method, { channel: message!.channel, ts: message!.ts, ...(chunks.length > 0 ? { chunks } : {}) })
      streamed += length
      return true
    }
    catch (error) {
      const code = slackError(error)
      if (code === 'stopped_by_user') {
        muted = true
        return true
      }
      if (code !== 'message_not_in_streaming_state') throw error
      await leaveStream(false)
      return false
    }
  }

  async function append(chunks: Chunk[]): Promise<void> {
    if (message!.mode === 'stream' && await stream('chat.appendStream', chunks)) return
    await client.call('chat.update', { channel: message!.channel, ts: message!.ts, text: render(true, null) })
  }

  async function flush(): Promise<void> {
    if (pending.length === 0 || signal?.aborted) return
    const chunks = pending
    const seq = pendingSeq
    pending = []
    try {
      if (message) await append(chunks)
      else await open(chunks)
      sentSeq = seq
      options.onSent?.(seq)
    }
    catch (error) {
      pending = [...chunks, ...pending]
      if (!signal?.aborted) log.error(`Slack progress in ${target.channel}/${target.threadTs} failed:`, error)
    }
  }

  function run<T>(work: () => Promise<T>): Promise<T> {
    const next = chain.then(work)
    chain = next.then(() => {}, () => {})
    return next
  }

  function schedule(): void {
    if (timer || finished) return
    timer = setTimeout(() => {
      timer = null
      void run(flush)
    }, message ? intervalMs : 0)
  }

  async function close(note: string | null): Promise<SlackTurnMessage | null> {
    const chunks = pending
    const seq = pendingSeq
    pending = []
    let parts: string[] = []
    if (!message) {
      parts = splitSlackText(render(false, note))
      if (parts.length === 0) return null
      const result = await client.call<{ ts?: unknown }>('chat.postMessage', { ...thread, text: parts[0] })
      remember(result.ts, 'message')
    }
    else if (message.mode !== 'stream' || !await stream('chat.stopStream', note ? [...chunks, { type: 'markdown_text', text: `\n\n${note}` }] : chunks)) {
      parts = splitSlackText(render(false, note))
      await client.call('chat.update', { channel: message!.channel, ts: message!.ts, text: parts[0] ?? '_(no reply)_' })
    }
    // Overflow goes out as plain replies after the message is final; losing one to a crash beats posting the turn twice.
    for (const part of parts.slice(1)) await client.call('chat.postMessage', { ...thread, text: part })
    sentSeq = seq
    options.onSent?.(seq)
    return message
  }

  return {
    push(event) {
      if (finished) return
      take(event, false)
      if (pending.length > 0) schedule()
    },
    async finish(note = null) {
      finished = true
      if (timer) clearTimeout(timer)
      timer = null
      return run(() => close(note))
    },
    abandon() {
      finished = true
      if (timer) clearTimeout(timer)
      timer = null
    },
    get message() { return message },
    get text() { return text },
  }
}
