import type { BotSlackConnection, BotSlackIdentity, BotSlackReasonCode } from '@candy-mountain/shared'
import WebSocket from 'ws'
import { createSlackClient, SlackApiError } from '../plugins/slack'
import type { SlackSelf, SocketModeEnvelope } from './events'

export interface SocketModeOptions {
  fetch?: typeof fetch
  /** First retry delay after a failure; doubles per failure up to `maxBackoffMs`. */
  initialBackoffMs?: number
  maxBackoffMs?: number
  /** Retry delay after Slack rejects a token, which only a token change fixes. */
  invalidTokenRetryMs?: number
  pingIntervalMs?: number
  /** A ping unanswered this long means the network dropped without a close. */
  pongTimeoutMs?: number
  helloTimeoutMs?: number
}

export const SOCKET_MODE_DEFAULTS = {
  initialBackoffMs: 1_000,
  maxBackoffMs: 60_000,
  invalidTokenRetryMs: 5 * 60_000,
  pingIntervalMs: 30_000,
  pongTimeoutMs: 10_000,
  helloTimeoutMs: 15_000,
} satisfies Required<Omit<SocketModeOptions, 'fetch'>>

export interface SocketModeConnectionInit {
  appToken: string
  botToken: string
  /** Called after the envelope is acknowledged. */
  onEnvelope(envelope: SocketModeEnvelope, self: SlackSelf | null): void
  onStatus?(status: BotSlackConnection): void
  options?: SocketModeOptions
}

export interface SocketModeConnection {
  status(): BotSlackConnection
  /** Resolves once the socket is closed and no retry is pending. */
  close(): Promise<void>
}

interface Failure {
  code: Extract<BotSlackReasonCode, 'invalid_token' | 'error'>
  reason: string
  retryAfterMs?: number
}

/** No failure means Slack asked for a fresh link, which it wants opened right away. */
interface Outcome {
  helloReceived: boolean
  failure: Failure | null
}

const TOKEN_ERRORS = new Set(['invalid_auth', 'not_authed', 'token_revoked', 'token_expired', 'account_inactive', 'not_allowed_token_type', 'missing_scope'])
const TOKEN_HINTS: Record<string, string> = {
  not_allowed_token_type: 'it is the wrong kind of token',
  missing_scope: 'the app-level token needs the connections:write scope',
}

function apiFailure(label: string, error: unknown): Failure {
  if (error instanceof SlackApiError) {
    if (error.slackError && TOKEN_ERRORS.has(error.slackError)) {
      const hint = TOKEN_HINTS[error.slackError] ?? 'it is invalid or has been revoked'
      return { code: 'invalid_token', reason: `Slack rejected the ${label}: ${error.slackError} (${hint}).` }
    }
    const retryAfterMs = error.retryAfterSeconds === undefined ? undefined : error.retryAfterSeconds * 1000
    return { code: 'error', reason: error.message, retryAfterMs }
  }
  return { code: 'error', reason: `Could not reach Slack: ${error instanceof Error ? error.message : String(error)}` }
}

const now = () => new Date().toISOString()

export function openSocketModeConnection(init: SocketModeConnectionInit): SocketModeConnection {
  const options = { ...SOCKET_MODE_DEFAULTS, ...init.options }
  const stop = new AbortController()
  const appClient = createSlackClient(init.appToken, { fetch: options.fetch, signal: stop.signal })
  const botClient = createSlackClient(init.botToken, { fetch: options.fetch, signal: stop.signal })
  let current: BotSlackConnection = { state: 'connecting', reason: null, reasonCode: null, since: now(), retryAt: null, identity: null }
  let self: SlackSelf | null = null
  let socket: WebSocket | null = null

  function setStatus(next: Omit<BotSlackConnection, 'since' | 'identity'>) {
    const changed = next.state !== current.state || next.reason !== current.reason || next.reasonCode !== current.reasonCode
    current = { ...next, since: changed ? now() : current.since, identity: current.identity }
    if (changed || next.retryAt) init.onStatus?.(current)
  }

  async function identify(): Promise<void> {
    const result = await botClient.call<{ team_id?: unknown, team?: unknown, user_id?: unknown, user?: unknown, bot_id?: unknown }>('auth.test')
    if (typeof result.user_id !== 'string' || typeof result.team_id !== 'string') {
      throw botClient.error('auth.test', 'invalid_response', 'Slack auth.test sent no user or team for the bot token.')
    }
    const identity: BotSlackIdentity = { teamId: result.team_id, team: String(result.team ?? ''), userId: result.user_id, user: String(result.user ?? '') }
    current = { ...current, identity }
    self = { userId: identity.userId, botId: typeof result.bot_id === 'string' ? result.bot_id : null }
  }

  async function socketUrl(): Promise<string> {
    const result = await appClient.call<{ url?: unknown }>('apps.connections.open')
    if (typeof result.url !== 'string') throw appClient.error('apps.connections.open', 'invalid_response', 'Slack apps.connections.open sent no URL.')
    return result.url
  }

  function session(url: string): Promise<Outcome> {
    return new Promise((resolve) => {
      const ws = new WebSocket(url)
      socket = ws
      let helloReceived = false
      let failure: Failure | null = null
      let awaitingPong = false
      let pingTimer: NodeJS.Timeout | undefined
      let pongTimer: NodeJS.Timeout | undefined
      const fail = (reason: string) => {
        failure ??= { code: 'error', reason }
        ws.terminate()
      }
      const helloTimer = setTimeout(() => fail('Slack sent no hello on the Socket Mode connection.'), options.helloTimeoutMs)

      ws.on('message', (data) => {
        let envelope: SocketModeEnvelope
        try {
          envelope = JSON.parse(data.toString()) as SocketModeEnvelope
        }
        catch {
          return
        }
        if (envelope.envelope_id) ws.send(JSON.stringify({ envelope_id: envelope.envelope_id }))

        if (envelope.type === 'hello') {
          helloReceived = true
          clearTimeout(helloTimer)
          setStatus({ state: 'connected', reason: null, reasonCode: null, retryAt: null })
          pingTimer = setInterval(() => {
            if (awaitingPong) return
            awaitingPong = true
            ws.ping()
            pongTimer = setTimeout(() => fail('Slack stopped answering pings.'), options.pongTimeoutMs)
          }, options.pingIntervalMs)
        }
        else if (envelope.type === 'disconnect') {
          if (envelope.reason === 'link_disabled') failure = { code: 'error', reason: 'Socket Mode is turned off for this Slack app.' }
          // A 'warning' precedes the close Slack is about to make itself.
          if (envelope.reason !== 'warning') ws.close()
        }
        else if (envelope.envelope_id) {
          try {
            init.onEnvelope(envelope, self)
          }
          catch (error) {
            console.error('Slack envelope handler failed:', error)
          }
        }
      })
      ws.on('pong', () => {
        awaitingPong = false
        clearTimeout(pongTimer)
      })
      ws.on('error', (error) => {
        failure ??= { code: 'error', reason: `The Socket Mode connection failed: ${error.message}` }
      })
      ws.on('close', (code) => {
        clearTimeout(helloTimer)
        clearInterval(pingTimer)
        clearTimeout(pongTimer)
        socket = null
        if (!helloReceived) failure ??= { code: 'error', reason: `The Socket Mode connection closed before Slack said hello (code ${code}).` }
        resolve({ helloReceived, failure })
      })
    })
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (stop.signal.aborted) return resolve()
      const done = () => {
        clearTimeout(timer)
        stop.signal.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      stop.signal.addEventListener('abort', done)
    })
  }

  async function attempt(): Promise<Outcome> {
    try {
      await identify()
    }
    catch (error) {
      return { helloReceived: false, failure: apiFailure('bot token', error) }
    }
    let url: string
    try {
      url = await socketUrl()
    }
    catch (error) {
      return { helloReceived: false, failure: apiFailure('app-level token', error) }
    }
    return stop.signal.aborted ? { helloReceived: false, failure: null } : session(url)
  }

  async function run(): Promise<void> {
    let failures = 0
    while (!stop.signal.aborted) {
      setStatus({ state: 'connecting', reason: null, reasonCode: null, retryAt: null })
      const outcome = await attempt()
      if (stop.signal.aborted) break
      if (outcome.helloReceived) failures = 0
      if (!outcome.failure) continue

      const { failure } = outcome
      const backoff = Math.min(options.maxBackoffMs, options.initialBackoffMs * 2 ** failures)
      failures++
      const delay = failure.retryAfterMs ?? (failure.code === 'invalid_token' ? options.invalidTokenRetryMs : backoff * (0.8 + Math.random() * 0.4))
      setStatus({ state: 'disconnected', reason: failure.reason, reasonCode: failure.code, retryAt: new Date(Date.now() + delay).toISOString() })
      await sleep(delay)
    }
    setStatus({ state: 'disconnected', reason: 'The connection was stopped.', reasonCode: 'stopped', retryAt: null })
  }

  const running = run()

  return {
    status: () => current,
    async close() {
      stop.abort()
      if (socket) {
        const closing = socket
        closing.close(1000)
        setTimeout(() => closing.terminate(), 1000).unref()
      }
      await running
    },
  }
}
