import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import type { SocketModeEnvelope } from './events'

export interface FakeSocketLink {
  appToken: string
  socket: WebSocket
  acks: string[]
  closed: boolean
  /** Stops answering pings, as a link whose network vanished without a close would. */
  silent: boolean
}

/** A local stand-in for Slack's Web API (auth.test, apps.connections.open) and its Socket Mode WebSocket. */
export interface FakeSocketMode {
  fetch: typeof fetch
  validAppTokens: Set<string>
  validBotTokens: Set<string>
  /** Every link ever opened, oldest first. */
  links: FakeSocketLink[]
  open(): FakeSocketLink[]
  /** When false, apps.connections.open fails as if Slack were unreachable. */
  reachable: boolean
  send(link: FakeSocketLink, envelope: SocketModeEnvelope): void
  /** Drops every open socket without a close frame, as a lost network would. */
  dropAll(): void
  close(): Promise<void>
}

let envelopeCounter = 0
export const nextEnvelopeId = () => `env-${++envelopeCounter}`

export async function startFakeSocketMode(): Promise<FakeSocketMode> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, autoPong: false })
  await new Promise<void>(resolve => server.once('listening', () => resolve()))
  const { port } = server.address() as AddressInfo
  const fake: FakeSocketMode = {
    validAppTokens: new Set(),
    validBotTokens: new Set(),
    links: [],
    reachable: true,
    open: () => fake.links.filter(link => !link.closed),
    send: (link, envelope) => link.socket.send(JSON.stringify(envelope)),
    dropAll: () => fake.open().forEach(link => link.socket.terminate()),
    fetch: async (input, init) => {
      const method = String(input).replace('https://slack.com/api/', '')
      const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? ''
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
      if (method === 'auth.test') {
        return fake.validBotTokens.has(token)
          ? json({ ok: true, team_id: 'T0CANDY', team: 'Candy', user_id: 'U0BOT', user: 'ana', bot_id: 'B0BOT' })
          : json({ ok: false, error: 'invalid_auth' })
      }
      if (method === 'apps.connections.open') {
        if (!fake.reachable) throw new TypeError('fetch failed')
        if (!fake.validAppTokens.has(token)) return json({ ok: false, error: 'invalid_auth' })
        return json({ ok: true, url: `ws://127.0.0.1:${port}/link?app=${encodeURIComponent(token)}` })
      }
      return json({ ok: false, error: 'unknown_method' })
    },
    async close() {
      for (const client of server.clients) client.terminate()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }

  server.on('connection', (socket, request) => {
    const appToken = new URL(request.url ?? '/', 'ws://x').searchParams.get('app') ?? ''
    const link: FakeSocketLink = { appToken, socket, acks: [], closed: false, silent: false }
    fake.links.push(link)
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as { envelope_id?: string }
      if (message.envelope_id) link.acks.push(message.envelope_id)
    })
    socket.on('ping', (data) => {
      if (!link.silent) socket.pong(data)
    })
    socket.on('close', () => {
      link.closed = true
    })
    socket.send(JSON.stringify({ type: 'hello', num_connections: 1, connection_info: { app_id: 'A0CANDY' } }))
  })

  return fake
}
