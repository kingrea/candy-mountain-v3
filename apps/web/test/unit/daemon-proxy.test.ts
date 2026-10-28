import { once } from 'node:events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DAEMON_UNREACHABLE_HEADER, isDaemonUnreachableBody, isDaemonUnreachableResponse } from '@candy-mountain/shared'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'
import { afterEach, describe, expect, it } from 'vitest'
import { proxyToDaemon, resolveDaemonUrl, toDaemonPath } from '../../server/utils/daemon-proxy'

const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    server.close()
  }
})

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function startProxy(daemonUrl: string) {
  const router = createRouter().use('/api/**', defineEventHandler(event => proxyToDaemon(event, daemonUrl)))
  return listen(toNodeListener(createApp().use(router)))
}

describe('resolveDaemonUrl', () => {
  it('prefers the configured url', () => {
    expect(resolveDaemonUrl('http://daemon:9000/', { CM_DAEMON_PORT: '1' })).toBe('http://daemon:9000')
  })

  it('falls back to the daemon env vars, then the defaults', () => {
    expect(resolveDaemonUrl('', { CM_DAEMON_HOST: '::1', CM_DAEMON_PORT: '5000' })).toBe('http://[::1]:5000')
    expect(resolveDaemonUrl(undefined, {})).toBe('http://127.0.0.1:4310')
  })
})

describe('toDaemonPath', () => {
  it('strips the api prefix and keeps the query', () => {
    expect(toDaemonPath('/api/health')).toBe('/health')
    expect(toDaemonPath('/api/projects/a?x=1')).toBe('/projects/a?x=1')
    expect(toDaemonPath('/api')).toBe('/')
    expect(toDaemonPath('/api?x=1')).toBe('/?x=1')
  })
})

describe('proxyToDaemon', () => {
  it('forwards method, path, body, cookies and accept, and returns status and set-cookie', async () => {
    const daemon = await listen(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      res.writeHead(201, { 'content-type': 'application/json', 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] })
      res.end(JSON.stringify({
        method: req.method,
        url: req.url,
        cookie: req.headers.cookie,
        accept: req.headers.accept,
        body: Buffer.concat(chunks).toString(),
      }))
    })
    const proxy = await startProxy(daemon)

    const response = await fetch(`${proxy}/api/things?x=1`, {
      method: 'POST',
      headers: { 'cookie': 'session=abc', 'accept': 'application/json', 'content-type': 'application/json' },
      body: '{"name":"thing"}',
    })

    expect(response.status).toBe(201)
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
    expect(await response.json()).toEqual({
      method: 'POST',
      url: '/things?x=1',
      cookie: 'session=abc',
      accept: 'application/json',
      body: '{"name":"thing"}',
    })
  })

  it('streams server-sent events without buffering', async () => {
    let sendSecond!: () => void
    const secondRequested = new Promise<void>(resolve => (sendSecond = resolve))
    const daemon = await listen(async (req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.write('data: one\n\n')
      await secondRequested
      res.end('data: two\n\n')
    })
    const proxy = await startProxy(daemon)

    const response = await fetch(`${proxy}/api/events`, { headers: { accept: 'text/event-stream' } })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()

    expect((await reader.read()).value).toBe('data: one\n\n')
    sendSecond()
    expect((await reader.read()).value).toBe('data: two\n\n')
    expect((await reader.read()).done).toBe(true)
  })

  it('closes the daemon stream when the client goes away', async () => {
    let daemonClosed!: () => void
    const closed = new Promise<void>(resolve => (daemonClosed = resolve))
    const daemon = await listen((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: hello\n\n')
      res.once('close', daemonClosed)
    })
    const proxy = await startProxy(daemon)

    const client = new AbortController()
    const response = await fetch(`${proxy}/api/events`, { signal: client.signal })
    await response.body!.getReader().read()
    client.abort()

    await expect(closed).resolves.toBeUndefined()
  })

  it('answers 502 when the daemon is unreachable', async () => {
    const proxy = await startProxy('http://127.0.0.1:1')
    const response = await fetch(`${proxy}/api/health`)
    expect(response.status).toBe(502)
    expect(response.headers.get(DAEMON_UNREACHABLE_HEADER)).toBe('1')
    const body = await response.json()
    expect(isDaemonUnreachableBody(body)).toBe(true)
    expect(body.daemonUrl).toBe('http://127.0.0.1:1')
    expect(isDaemonUnreachableResponse(response)).toBe(true)
  })

  it.each([500, 404, 502])('passes a daemon-produced %i through unmarked', async (status) => {
    const daemon = await listen((_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end('{"error":{"code":"x","message":"y"}}')
    })
    const proxy = await startProxy(daemon)
    const response = await fetch(`${proxy}/api/anything`)
    expect(response.status).toBe(status)
    expect(isDaemonUnreachableResponse(response)).toBe(false)
  })
})
