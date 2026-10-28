/** A Socket Mode frame as Slack sends it; every frame with an `envelope_id` must be acknowledged. */
export interface SocketModeEnvelope {
  type: string
  envelope_id?: string
  payload?: unknown
  retry_attempt?: number
  retry_reason?: string
  reason?: string
  [key: string]: unknown
}

export interface SlackEventContext {
  /** The Candy Mountain bot that received it. */
  botId: string
  projectId: string
  envelopeId: string
  /** 0 on first delivery; Slack redelivers events it saw no acknowledgement for. */
  retryAttempt: number
  retryReason: string | null
  receivedAt: string
  /** The bot's own Slack user, to strip `<@U…>` mentions and ignore its own posts. */
  botUserId: string | null
}

export interface SlackMessageEvent {
  channel: string
  channelType: string | null
  user: string | null
  /** Set when another bot (or this one) posted it. */
  senderBotId: string | null
  subtype: string | null
  text: string
  ts: string
  /** Null for a top-level message; equal to `ts` for a thread's parent. */
  threadTs: string | null
  raw: Record<string, unknown>
}

export interface SlackMessageBotEvent extends SlackEventContext {
  kind: 'app_mention' | 'message'
  /** Unique per event across retries: the dedup key. */
  eventId: string
  teamId: string | null
  fromSelf: boolean
  event: SlackMessageEvent
}

export interface SlackSlashCommand {
  command: string
  text: string
  userId: string
  channelId: string
  teamId: string | null
  responseUrl: string | null
  triggerId: string | null
  raw: Record<string, unknown>
}

export interface SlackSlashBotEvent extends SlackEventContext {
  kind: 'slash'
  command: SlackSlashCommand
}

export interface SlackAction {
  actionId: string
  blockId: string | null
  type: string
  value: string | null
}

export interface SlackInteraction {
  /** Slack's payload type, such as 'block_actions' or 'view_submission'. */
  type: string
  userId: string | null
  channelId: string | null
  messageTs: string | null
  threadTs: string | null
  actions: SlackAction[]
  responseUrl: string | null
  triggerId: string | null
  raw: Record<string, unknown>
}

export interface SlackInteractiveBotEvent extends SlackEventContext {
  kind: 'interactive'
  interaction: SlackInteraction
}

export type SlackBotEvent = SlackMessageBotEvent | SlackSlashBotEvent | SlackInteractiveBotEvent
export type SlackBotEventKind = SlackBotEvent['kind']

export type SlackEventListener = (event: SlackBotEvent) => void | Promise<void>

export interface SlackEventSubscribeOptions {
  botId?: string
  kinds?: readonly SlackBotEventKind[]
}

export interface SlackEventBus {
  subscribe(listener: SlackEventListener, options?: SlackEventSubscribeOptions): () => void
  emit(event: SlackBotEvent): void
}

type Log = Pick<Console, 'error'>

export function createSlackEventBus(log: Log = console): SlackEventBus {
  const listeners = new Set<{ listener: SlackEventListener, options: SlackEventSubscribeOptions }>()
  const report = (error: unknown) => log.error('Slack event listener failed:', error)
  return {
    subscribe(listener, options = {}) {
      const entry = { listener, options }
      listeners.add(entry)
      return () => void listeners.delete(entry)
    },
    emit(event) {
      for (const { listener, options } of [...listeners]) {
        if (options.botId !== undefined && options.botId !== event.botId) continue
        if (options.kinds && !options.kinds.includes(event.kind)) continue
        try {
          const result = listener(event)
          if (result instanceof Promise) result.catch(report)
        }
        catch (error) {
          report(error)
        }
      }
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

export interface SlackSelf {
  userId: string
  botId: string | null
}

/** Null for envelopes nothing consumes, such as reactions or event types the app did not subscribe to. */
export function toSlackBotEvent(envelope: SocketModeEnvelope, base: Omit<SlackEventContext, 'envelopeId' | 'retryAttempt' | 'retryReason' | 'botUserId'>, self: SlackSelf | null): SlackBotEvent | null {
  if (!envelope.envelope_id || !isRecord(envelope.payload)) return null
  const payload = envelope.payload
  const context: SlackEventContext = {
    ...base,
    envelopeId: envelope.envelope_id,
    retryAttempt: typeof envelope.retry_attempt === 'number' ? envelope.retry_attempt : 0,
    retryReason: str(envelope.retry_reason),
    botUserId: self?.userId ?? null,
  }

  if (envelope.type === 'events_api') {
    const event = payload.event
    const eventId = str(payload.event_id)
    if (!isRecord(event) || !eventId || (event.type !== 'app_mention' && event.type !== 'message')) return null
    const channel = str(event.channel)
    const ts = str(event.ts)
    if (!channel || !ts) return null
    const user = str(event.user)
    const senderBotId = str(event.bot_id)
    return {
      ...context,
      kind: event.type,
      eventId,
      teamId: str(payload.team_id),
      fromSelf: self !== null && ((user !== null && user === self.userId) || (senderBotId !== null && senderBotId === self.botId)),
      event: {
        channel,
        channelType: str(event.channel_type),
        user,
        senderBotId,
        subtype: str(event.subtype),
        text: typeof event.text === 'string' ? event.text : '',
        ts,
        threadTs: str(event.thread_ts),
        raw: event,
      },
    }
  }

  if (envelope.type === 'slash_commands') {
    const command = str(payload.command)
    const userId = str(payload.user_id)
    const channelId = str(payload.channel_id)
    if (!command || !userId || !channelId) return null
    return {
      ...context,
      kind: 'slash',
      command: {
        command,
        text: typeof payload.text === 'string' ? payload.text : '',
        userId,
        channelId,
        teamId: str(payload.team_id),
        responseUrl: str(payload.response_url),
        triggerId: str(payload.trigger_id),
        raw: payload,
      },
    }
  }

  if (envelope.type === 'interactive') {
    const type = str(payload.type)
    if (!type) return null
    const user = isRecord(payload.user) ? payload.user : {}
    const channel = isRecord(payload.channel) ? payload.channel : {}
    const container = isRecord(payload.container) ? payload.container : {}
    const message = isRecord(payload.message) ? payload.message : {}
    const actions = (Array.isArray(payload.actions) ? payload.actions : []).filter(isRecord).flatMap((action): SlackAction[] => {
      const actionId = str(action.action_id)
      return actionId ? [{ actionId, blockId: str(action.block_id), type: str(action.type) ?? 'unknown', value: str(action.value) }] : []
    })
    return {
      ...context,
      kind: 'interactive',
      interaction: {
        type,
        userId: str(user.id),
        channelId: str(channel.id) ?? str(container.channel_id),
        messageTs: str(message.ts) ?? str(container.message_ts),
        threadTs: str(message.thread_ts) ?? str(container.thread_ts),
        actions,
        responseUrl: str(payload.response_url),
        triggerId: str(payload.trigger_id),
        raw: payload,
      },
    }
  }

  return null
}
