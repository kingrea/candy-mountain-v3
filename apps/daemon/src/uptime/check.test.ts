import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { MonitorOptions } from '@candy-mountain/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HTTP_SOURCE, MONITOR_SOURCE_REGISTRY, STATPING_SOURCE, STATUSIO_SOURCE, STATUSPAGE_SOURCE } from './builtin-sources'
import type { MonitorCheckResult } from './check'
import { runMonitorCheck } from './service'
import { createMonitorSourceRegistry, defineMonitorSource, type MonitorSource } from './sources'

type Handler = (url: URL) => Response | Promise<Response>

function stub(handler: Handler) {
  const urls: string[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe('manual')
    const url = new URL(input instanceof Request ? input.url : input)
    urls.push(url.href)
    return handler(url)
  }) as typeof globalThis.fetch
  return { fetch, urls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Never answers; resolves only when the probe aborts it. */
const hang = { fetch: ((_: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
  init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
})) as typeof globalThis.fetch }

const run = (source: MonitorSource, target: string, options: MonitorOptions, fetch: typeof globalThis.fetch, timeoutMs = 50) =>
  source.check({ target, options, fetch, timeoutMs })

function expectResult(result: MonitorCheckResult, status: MonitorCheckResult['status'], detail?: RegExp) {
  expect(result.status).toBe(status)
  expect(result.ok).toBe(status === 'up')
  if (detail) expect(result.detail).toMatch(detail)
  else if (status === 'up') expect(result.detail).toBeNull()
  expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false)
}

describe('http check', () => {
  const target = 'https://app.example.com/health'
  const http = (options: MonitorOptions, handler: Handler) => run(HTTP_SOURCE, target, options, stub(handler).fetch)

  it('is up on the expected status and body text', async () => {
    const result = await http({ expectedStatus: 200, responseContains: 'healthy' }, () => new Response('all healthy'))
    expectResult(result, 'up')
    expect(result.httpStatus).toBe(200)
    expectResult(await http({ expectedStatus: 204 }, () => new Response(null, { status: 204 })), 'up')
  })

  it('is down on a wrong status or a missing substring, without echoing the body', async () => {
    const wrong = await http({ expectedStatus: 200 }, () => new Response('secret page', { status: 503 }))
    expectResult(wrong, 'down', /Expected status 200, got 503/)
    expect(wrong.httpStatus).toBe(503)
    const missing = await http({ expectedStatus: 200, responseContains: 'healthy' }, () => new Response('secret page'))
    expectResult(missing, 'down', /does not contain the expected text/)
    expect(missing.detail).not.toMatch(/secret/)
  })

  it('is down on a timeout, a DNS failure or a refused connection', async () => {
    expectResult(await run(HTTP_SOURCE, target, { expectedStatus: 200 }, hang.fetch), 'down', /Timed out after 0.05 s/)
    const failing = (code: string) => stub(() => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error(`getaddrinfo ${code} app.example.com`), { code }) })
    }).fetch
    expectResult(await run(HTTP_SOURCE, target, {}, failing('ENOTFOUND')), 'down', /DNS lookup failed for app.example.com/)
    expectResult(await run(HTTP_SOURCE, target, {}, failing('ECONNREFUSED')), 'down', /Connection refused/)
  })

  it('times out a body that stalls after the headers', async () => {
    const stalled = stub(() => new Response(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode('partial')) })))
    expectResult(await run(HTTP_SOURCE, target, { expectedStatus: 200, responseContains: 'ok' }, stalled.fetch), 'down', /Timed out/)
  })

  it('refuses to read a body beyond the cap', async () => {
    const huge = stub(() => new Response('x'.repeat(3 * 1024 * 1024)))
    expectResult(await run(HTTP_SOURCE, target, { expectedStatus: 200, responseContains: 'ok' }, huge.fetch, 2000), 'down', /larger than 2 MB/)
  })

  it('follows same-host redirects only', async () => {
    const same = stub(url => (url.pathname === '/health' ? new Response(null, { status: 302, headers: { location: '/ready' } }) : new Response('ok')))
    expectResult(await run(HTTP_SOURCE, target, { expectedStatus: 200, responseContains: 'ok' }, same.fetch), 'up')
    expect(same.urls).toEqual([target, 'https://app.example.com/ready'])

    const away = stub(() => new Response(null, { status: 301, headers: { location: 'https://evil.example.net/x' } }))
    expectResult(await run(HTTP_SOURCE, target, {}, away.fetch), 'down', /another host \(evil.example.net\)/)
    expect(away.urls).toHaveLength(1)

    const downgrade = stub(() => new Response(null, { status: 301, headers: { location: 'http://app.example.com/health' } }))
    expectResult(await run(HTTP_SOURCE, target, {}, downgrade.fetch), 'down', /another host/)

    const loop = stub(() => new Response(null, { status: 302, headers: { location: '/health' } }))
    expectResult(await run(HTTP_SOURCE, target, {}, loop.fetch), 'down', /More than 5 redirects/)
  })

  it('does not follow a redirect that is itself the expected status', async () => {
    const redirect = stub(() => new Response(null, { status: 301, headers: { location: 'https://elsewhere.example.net/' } }))
    expectResult(await run(HTTP_SOURCE, target, { expectedStatus: 301 }, redirect.fetch), 'up')
    expect(redirect.urls).toHaveLength(1)
  })

  it('keeps credentials in the target out of the detail', async () => {
    const leaky = stub((url) => {
      throw new TypeError(`could not fetch ${url.href}`)
    })
    const result = await run(HTTP_SOURCE, 'https://jack:hunter2@app.example.com/health?token=abc123', {}, leaky.fetch)
    expectResult(result, 'down', /Request failed/)
    expect(result.detail).not.toMatch(/hunter2|abc123/)
  })

  it('is cancelled by the caller\'s signal', async () => {
    const controller = new AbortController()
    const pending = HTTP_SOURCE.check({ target, options: {}, fetch: hang.fetch, signal: controller.signal, timeoutMs: 5000 })
    controller.abort()
    expectResult(await pending, 'down', /Check cancelled/)
  })
})

describe('vendor checks', () => {
  const feed = (body: unknown) => stub(() => json(body)).fetch

  it('reads a Statuspage component', async () => {
    const page = 'https://status.vendor.com/api/v2/components.json'
    const components = (status: string) => feed({ page: {}, components: [{ id: 'other', status: 'major_outage' }, { id: 'abc', status }] })
    const check = (status: string) => run(STATUSPAGE_SOURCE, page, { componentId: 'abc' }, components(status))
    expectResult(await check('operational'), 'up')
    expectResult(await check('under_maintenance'), 'up')
    expectResult(await check('degraded_performance'), 'degraded', /degraded performance/)
    expectResult(await check('partial_outage'), 'degraded', /partial outage/)
    expectResult(await check('major_outage'), 'down', /major outage/)
    expectResult(await check('mystery'), 'degraded', /Unrecognised status 'mystery'/)
    expectResult(await run(STATUSPAGE_SOURCE, page, { componentId: 'gone' }, components('operational')), 'down', /Component gone is not in the feed/)
    expectResult(await run(STATUSPAGE_SOURCE, page, { componentId: 'abc' }, hang.fetch), 'down', /Timed out/)
  })

  it('reads a Status.io component in one container', async () => {
    const page = 'https://api.status.io/1.0/status/page1'
    const body = (code: number, status: string) => feed({ result: { status: [{ id: 'comp', status, status_code: code, containers: [{ id: 'eu', status, status_code: code }] }] } })
    const check = (code: number, status: string, options = { componentId: 'comp', containerId: 'eu' }) => run(STATUSIO_SOURCE, page, options, body(code, status))
    expectResult(await check(100, 'Operational'), 'up')
    expectResult(await check(200, 'Planned Maintenance'), 'up')
    expectResult(await check(300, 'Degraded Performance'), 'degraded', /Degraded Performance \(300\)/)
    expectResult(await check(400, 'Partial Service Disruption'), 'degraded', /\(400\)/)
    expectResult(await check(500, 'Service Disruption'), 'down', /Service Disruption \(500\)/)
    expectResult(await check(100, 'Operational', { componentId: 'comp', containerId: 'us' }), 'down', /Container us is not in component comp/)
    expectResult(await run(STATUSIO_SOURCE, page, { componentId: 'comp', containerId: 'eu' }, hang.fetch), 'down', /Timed out/)
  })

  it('reads a Statping service from the list or a single service', async () => {
    const services = 'https://status.vendor.com/api/services'
    const list = (online: boolean) => feed([{ id: 1, online: true }, { id: 7, online, last_success: '2026-10-28T01:00:00Z' }])
    expectResult(await run(STATPING_SOURCE, services, { serviceId: 7 }, list(true)), 'up')
    expectResult(await run(STATPING_SOURCE, services, { serviceId: 7 }, list(false)), 'down', /Offline \(last success 2026-10-28T01:00:00Z\)/)
    expectResult(await run(STATPING_SOURCE, `${services}/7`, { serviceId: 7 }, feed({ id: 7, online: true })), 'up')
    expectResult(await run(STATPING_SOURCE, `${services}/8`, { serviceId: 7 }, feed({ id: 8, online: true })), 'down', /Service 7 is not in the feed/)
    expectResult(await run(STATPING_SOURCE, services, { serviceId: 7 }, hang.fetch), 'down', /Timed out/)
  })

  it('is down when the feed fails, is not JSON or has the wrong shape', async () => {
    const options = { componentId: 'abc' }
    const page = 'https://status.vendor.com/api/v2/components.json'
    expectResult(await run(STATUSPAGE_SOURCE, page, options, stub(() => json({}, 503)).fetch), 'down', /status feed returned 503/)
    expectResult(await run(STATUSPAGE_SOURCE, page, options, stub(() => new Response('<html>')).fetch), 'down', /not JSON/)
    expectResult(await run(STATUSPAGE_SOURCE, page, options, feed({ components: 'nope' })), 'down', /unexpected shape/)
  })
})

describe('runMonitorCheck', () => {
  it('runs the monitor\'s source check', async () => {
    const result = await runMonitorCheck({ sourceType: 'http', target: 'https://app.example.com/', options: { expectedStatus: 200 } }, { fetch: stub(() => new Response('ok')).fetch })
    expectResult(result, 'up')
  })

  it('never rejects for an unknown type or a checker that throws', async () => {
    expectResult(await runMonitorCheck({ sourceType: 'gopher', target: 'https://x.example.com/', options: {} }), 'down', /Unknown monitor source "gopher"/)
    const broken = defineMonitorSource({ id: 'broken', label: 'Broken', description: 'Throws.', targetLabel: 'URL', fields: [], check: () => Promise.reject(new Error('boom')) })
    const sources = createMonitorSourceRegistry([broken])
    expectResult(await runMonitorCheck({ sourceType: 'broken', target: 'https://x.example.com/', options: {} }, { sources }), 'down', /Broken checker failed unexpectedly/)
    expect(MONITOR_SOURCE_REGISTRY.ids()).toEqual(['http', 'statuspage', 'statusio', 'statping'])
  })
})

describe('http check against a local service', () => {
  let server: Server
  let base: string
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/health') res.writeHead(200, { 'content-type': 'text/plain' }).end('status: ok')
      else if (req.url === '/old') res.writeHead(302, { location: '/health' }).end()
      else if (req.url === '/away') res.writeHead(302, { location: 'http://localhost.invalid/health' }).end()
      else if (req.url === '/slow') setTimeout(() => res.end('late'), 1000)
      else res.writeHead(503).end('down')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })

  const check = (path: string, options: MonitorOptions = { expectedStatus: 200 }, timeoutMs = 2000) =>
    runMonitorCheck({ sourceType: 'http', target: `${base}${path}`, options }, { timeoutMs })

  it('checks a real endpoint', async () => {
    const result = await check('/health', { expectedStatus: 200, responseContains: 'ok' })
    expectResult(result, 'up')
    expect(result.httpStatus).toBe(200)
    expectResult(await check('/old'), 'up')
    expectResult(await check('/away'), 'down', /another host/)
    expectResult(await check('/broken'), 'down', /got 503/)
    expectResult(await check('/slow', { expectedStatus: 200 }, 100), 'down', /Timed out/)
  })

  it('reports a refused connection', async () => {
    const closed = createServer()
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve))
    const port = (closed.address() as AddressInfo).port
    await new Promise(resolve => closed.close(resolve))
    const result = await runMonitorCheck({ sourceType: 'http', target: `http://127.0.0.1:${port}/`, options: {} })
    expectResult(result, 'down', /Connection refused/)
    expect(result.httpStatus).toBeNull()
  })
})
