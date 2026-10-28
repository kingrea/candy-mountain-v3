import type { LiveVersionSettings } from '@candy-mountain/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readCustomEndpoint, validateCustomEndpoint } from './custom-endpoint'
import { json, startFakeEndpoint, unreachableUrl, type FakeEndpoint } from './fake-endpoint'

const DEBUG = { branch: 'main', buildStartedAt: '2026-10-27T09:30:00+11:00', commit: 'a1b2c3d', message: 'Fix', site: { url: 'https://shop.example.com/' } }

let endpoint: FakeEndpoint
beforeAll(async () => {
  endpoint = await startFakeEndpoint((req, res) => {
    switch (req.url) {
      case '/api/debug': return json(res, DEBUG)
      case '/nested': return json(res, { data: { deploys: [{ meta: { 'git.ref': 'release/2', 'sha': 12345 }, at: 1793000000, href: '/deploys/7' }] } })
      case '/odd-types': return json(res, { version: { major: 1 }, branch: 42, when: 'last tuesday', link: 'javascript:alert(1)' })
      case '/broken': return json(res, { error: 'boom' }, 503)
      case '/not-json': res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html></html>')
      case '/hop': res.writeHead(302, { location: '/api/debug' }); return res.end()
      case '/elsewhere': res.writeHead(301, { location: 'http://localhost.invalid/api/debug' }); return res.end()
      case '/loop': res.writeHead(302, { location: '/loop' }); return res.end()
      case '/huge': return json(res, { pad: 'x'.repeat(1024 * 1024 + 10) })
      case '/slow': return setTimeout(() => json(res, DEBUG), 2000)
      default: return json(res, {}, 404)
    }
  })
})
afterAll(() => endpoint.close())

const read = (path: string, mapping: Partial<Record<string, string>>, options = {}) =>
  readCustomEndpoint({ url: endpoint.url(path), ...mapping } as LiveVersionSettings, options)

describe('custom endpoint source', () => {
  it('maps the four fields from a digital-hub style debug endpoint', async () => {
    const version = await read('/api/debug', { versionPath: 'commit', branchPath: 'branch', deployedAtPath: 'buildStartedAt', linkPath: 'site.url' })
    expect(version).toEqual({ version: 'a1b2c3d', branch: 'main', deployedAt: '2026-10-26T22:30:00.000Z', link: 'https://shop.example.com/' })
  })

  it('reads nested, bracketed and indexed paths and converts numbers and relative links', async () => {
    const version = await read('/nested', {
      versionPath: 'data.deploys[0].meta.sha',
      branchPath: 'data.deploys[0].meta["git.ref"]',
      deployedAtPath: '$.data.deploys.0.at',
      linkPath: 'data.deploys[0].href',
    })
    expect(version).toEqual({ version: '12345', branch: 'release/2', deployedAt: new Date(1793000000 * 1000).toISOString(), link: endpoint.url('/deploys/7') })
  })

  it('leaves out fields whose path is missing or unmapped', async () => {
    expect(await read('/api/debug', { versionPath: 'commit', branchPath: 'git.branch', deployedAtPath: 'deployedAt' })).toEqual({ version: 'a1b2c3d' })
    expect(await read('/api/debug', { branchPath: 'branch' })).toEqual({ branch: 'main' })
  })

  it('leaves out values of the wrong type rather than guessing', async () => {
    expect(await read('/odd-types', { versionPath: 'version', branchPath: 'branch', deployedAtPath: 'when', linkPath: 'link' })).toEqual({})
  })

  it('fails when none of the mapped paths exist', async () => {
    await expect(read('/api/debug', { versionPath: 'sha', branchPath: 'ref' })).rejects.toThrow(/None of the mapped paths/)
  })

  it('reports HTTP errors, non-JSON bodies and oversized bodies', async () => {
    await expect(read('/broken', { versionPath: 'commit' })).rejects.toThrow(/returned HTTP 503/)
    await expect(read('/not-json', { versionPath: 'commit' })).rejects.toThrow(/did not return JSON/)
    await expect(read('/huge', { versionPath: 'commit' })).rejects.toThrow(/larger than 1024 KiB/)
  })

  it('follows redirects on the same host only', async () => {
    expect(await read('/hop', { versionPath: 'commit' })).toEqual({ version: 'a1b2c3d' })
    await expect(read('/elsewhere', { versionPath: 'commit' })).rejects.toThrow(/redirected to localhost.invalid; only redirects on the same host/)
    await expect(read('/loop', { versionPath: 'commit' })).rejects.toThrow(/redirected more than 5 times/)
  })

  it('gives up after the timeout and reports an unreachable host', async () => {
    await expect(read('/slow', { versionPath: 'commit' }, { timeoutMs: 200 })).rejects.toThrow(/No response from 127\.0\.0\.1:\d+ within 0\.2s/)
    const url = await unreachableUrl()
    await expect(readCustomEndpoint({ url, versionPath: 'commit' })).rejects.toThrow(/Could not reach 127\.0\.0\.1:\d+: ECONNREFUSED/)
  })

  it('validates the URL, each path and that something is mapped', () => {
    expect(validateCustomEndpoint({ url: 'https://example.com/v', versionPath: 'commit' })).toEqual([])
    expect(validateCustomEndpoint({ url: 'https://example.com/v' })).toEqual([{ field: '', message: expect.stringMatching(/Map at least one/) }])
    expect(validateCustomEndpoint({ url: 'ftp://example.com', versionPath: 'a..b' }).map(e => e.field)).toEqual(['url', 'versionPath'])
  })
})
