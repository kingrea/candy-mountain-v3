import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PLUGINS_PATH, PROJECTS_PATH, type Actor, type CodexLoginAttempt, type CodexLoginStatusResponse, type CodexRevokeResponse, type PluginInstance, type PluginInstanceResponse, type Project } from '@candy-mountain/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTestApp } from '../../testing/platform'
import { ensureDataDir, type DataPaths } from '../../data-dir'
import type { PlatformDatabase } from '../../db'
import { createProject } from '../../projects/projects'
import { createSecretsStore, MasterKey } from '../../secrets'
import { openTestDatabase } from '../../testing'
import { createPluginInstance, testPluginInstance } from '../instances'
import { createPluginTypeRegistry } from '../registry'
import { createCodexPluginType } from '../types/codex'
import { CODEX_LOGIN_FAILURES, CodexLoginAttempts, type CodexLoginAttemptsOptions } from './attempts'
import { interpretCodexStatus, parseDeviceAuthPrompt } from './cli'
import { FAKE_USER_CODE, FAKE_VERIFICATION_URL, installFakeCodex, type FakeCodex } from './fake-codex'
import { codexHome } from './home'
import { codexLaunchContext } from './launch'

interface Harness {
  root: string
  paths: DataPaths
  fake: FakeCodex
  attempts: CodexLoginAttempts
  database: PlatformDatabase
  deps: Parameters<typeof codexLaunchContext>[0] & Parameters<typeof testPluginInstance>[0]
  project(slug: string): Promise<{ project: Project, instance: PluginInstance, home: string }>
  call(method: string, path: string): Promise<Response>
  deleteProject(slug: string): Promise<Response>
  close(): Promise<void>
}

let h: Harness | undefined

afterEach(async () => {
  await h?.close()
  h = undefined
  vi.unstubAllEnvs()
})

function harness(options: CodexLoginAttemptsOptions = {}, config: Record<string, unknown> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'candy-mountain-codex-'))
  const fake = installFakeCodex(join(root, 'fake'))
  vi.stubEnv('PATH', `${fake.binDir}:${process.env.PATH ?? ''}`)
  vi.stubEnv('OPENAI_API_KEY', 'sk-must-not-reach-codex')
  const paths = ensureDataDir(join(root, 'data'))
  const database = openTestDatabase()
  const store = createSecretsStore(paths.secrets, MasterKey.generate())
  const attempts = new CodexLoginAttempts({ killGraceMs: 500, ...options })
  const pluginTypes = createPluginTypeRegistry([createCodexPluginType(attempts)])
  const deps = { db: database.db, pluginTypes, secrets: store.writeOnly, secretsReader: store, paths }
  const admin: Actor = { id: 'u1', username: 'jack', displayName: 'Jack', roles: ['admin'] }
  const app = createTestApp({ db: database.db, paths, auth: { name: 'development', resolve: () => admin }, pluginTypes, secrets: store.writeOnly, secretsReader: store })
  return {
    root,
    paths,
    fake,
    attempts,
    database,
    deps,
    async project(slug) {
      const checkout = join(root, 'repos', slug)
      mkdirSync(checkout, { recursive: true })
      const project = await createProject(database.db, { name: slug, slug, source: { kind: 'local-path', path: checkout } })
      const instance = createPluginInstance(deps, { type: 'codex', scope: 'project', projectId: project.id, config })
      return { project, instance, home: codexHome(paths, instance.id) }
    },
    call: (method, path) => Promise.resolve(app.request(`${PLUGINS_PATH}${path}`, { method })),
    deleteProject: slug => Promise.resolve(app.request(`${PROJECTS_PATH}/${slug}`, { method: 'DELETE' })),
    async close() {
      await attempts.close()
      database.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

async function json<T>(res: Response | Promise<Response>, status = 200): Promise<T> {
  const response = await res
  expect(response.status, await response.clone().text()).toBe(status)
  return await response.json() as T
}

async function waitFor<T>(read: () => T | Promise<T>, done: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting; last value ${JSON.stringify(value)}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}

const status = (id: string) => json<CodexLoginStatusResponse>(h!.call('GET', `/${id}/login-status`))
const health = async (id: string) => (await json<PluginInstanceResponse>(h!.call('POST', `/${id}/test`))).instance.health
const stored = async (id: string) => (await json<PluginInstanceResponse>(h!.call('GET', `/${id}`))).instance.health

describe('codex device login', () => {
  it('starts the device login in the instance\'s private home and returns the URL and code', async () => {
    h = harness()
    const { instance, home } = await h.project('alpha')
    const before = Date.now()

    const attempt = await json<CodexLoginAttempt>(h.call('POST', `/${instance.id}/start-login`))

    expect(attempt).toMatchObject({ status: 'waiting', verificationUrl: FAKE_VERIFICATION_URL, userCode: FAKE_USER_CODE, attemptId: expect.any(String), endedAt: null, failure: null })
    const ttl = Date.parse(attempt.expiresAt) - before
    expect(ttl).toBeGreaterThan(9 * 60_000)
    expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 1_000)
    expect(home).toBe(join(h.paths.agentHomes, 'codex', instance.id))
    expect(statSync(home).mode & 0o777).toBe(0o700)
    expect(statSync(join(h.paths.agentHomes, 'codex')).mode & 0o777).toBe(0o700)

    const env = h.fake.loginEnv(home)!
    expect(env).toMatchObject({ CODEX_HOME: home, NO_BROWSER: '1' })
    expect(env.OPENAI_API_KEY).toBeUndefined()

    expect((await status(instance.id)).attempt).toEqual(attempt)
    const again = await json<CodexLoginAttempt>(h.call('POST', `/${instance.id}/start-login`))
    expect(again.attemptId).toBe(attempt.attemptId)
  })

  it('reports logged in once the browser completes the login', async () => {
    h = harness()
    const { instance, home } = await h.project('alpha')
    expect(await health(instance.id)).toMatchObject({ healthy: false, reason: expect.stringMatching(/not logged in/) })

    await json<CodexLoginAttempt>(h.call('POST', `/${instance.id}/start-login`))
    h.fake.complete(home)

    const done = await waitFor(() => status(instance.id), r => r.attempt?.status !== 'waiting')
    expect(done.attempt).toMatchObject({ status: 'succeeded', verificationUrl: null, userCode: null, failure: null, endedAt: expect.any(String) })
    expect(await stored(instance.id)).toEqual({ healthy: true, detail: 'Codex is logged in using ChatGPT.', checkedAt: expect.any(String) })
  })

  it('records a failed login and stays logged out', async () => {
    h = harness()
    const { instance, home } = await h.project('alpha')
    await json<CodexLoginAttempt>(h.call('POST', `/${instance.id}/start-login`))
    h.fake.fail(home)

    const done = await waitFor(() => status(instance.id), r => r.attempt?.status !== 'waiting')
    expect(done.attempt).toMatchObject({ status: 'failed', failure: CODEX_LOGIN_FAILURES.exited })
    expect(await health(instance.id)).toMatchObject({ healthy: false })
  })

  it('revoke ends an open attempt and deletes the home', async () => {
    h = harness()
    const { instance, home } = await h.project('alpha')
    await json<CodexLoginAttempt>(h.call('POST', `/${instance.id}/start-login`))
    h.fake.complete(home)
    await waitFor(() => status(instance.id), r => r.attempt?.status === 'succeeded')
    expect(await stored(instance.id)).toMatchObject({ healthy: true })

    await json<CodexLoginAttempt>(h.call('POST', `/${instance.id}/start-login`))
    const pid = h.fake.loginPid(home)!
    expect(alive(pid)).toBe(true)

    expect(await json<CodexRevokeResponse>(h.call('POST', `/${instance.id}/revoke`))).toEqual({ removed: true })
    expect(alive(pid)).toBe(false)
    expect(() => statSync(home)).toThrow()
    expect((await status(instance.id)).attempt).toBeNull()
    expect(await stored(instance.id)).toMatchObject({ healthy: false, reason: expect.stringMatching(/not logged in/) })
    expect(await json<CodexRevokeResponse>(h.call('POST', `/${instance.id}/revoke`))).toEqual({ removed: false })
  })

  it('deleting the instance ends an open attempt and removes the home', async () => {
    h = harness()
    const { instance, home } = await h.project('alpha')
    await json<CodexLoginAttempt>(h.call('POST', `/${instance.id}/start-login`))
    const pid = h.fake.loginPid(home)!
    expect((await h.call('DELETE', `/${instance.id}`)).status).toBe(204)
    expect(alive(pid)).toBe(false)
    expect(() => statSync(home)).toThrow()
  })

  it('deleting a project removes its instance\'s home only', async () => {
    h = harness()
    const alpha = await h.project('alpha')
    const beta = await h.project('beta')
    for (const { instance, home } of [alpha, beta]) {
      await json<CodexLoginAttempt>(h.call('POST', `/${instance.id}/start-login`))
      h.fake.complete(home)
      await waitFor(() => status(instance.id), r => r.attempt?.status === 'succeeded')
    }
    expect((await h.deleteProject('alpha')).status).toBe(204)
    expect(() => statSync(alpha.home)).toThrow()
    expect(statSync(beta.home).isDirectory()).toBe(true)
  })

  it('expires an attempt that is not completed in time and ends the CLI', async () => {
    h = harness({ ttlMs: 400 })
    const { instance, home } = await h.project('alpha')
    await json<CodexLoginAttempt>(h.call('POST', `/${instance.id}/start-login`))
    const pid = h.fake.loginPid(home)!

    const done = await waitFor(() => status(instance.id), r => r.attempt?.status !== 'waiting')
    expect(done.attempt).toMatchObject({ status: 'expired', failure: CODEX_LOGIN_FAILURES.expired, userCode: null })
    await waitFor(() => alive(pid), running => !running)
    const next = await json<CodexLoginAttempt>(h.call('POST', `/${instance.id}/start-login`))
    expect(next.attemptId).not.toBe(done.attempt!.attemptId)
  })

  it('gives each project its own home and login', async () => {
    h = harness()
    const alpha = await h.project('alpha')
    const beta = await h.project('beta')
    expect(alpha.home).not.toBe(beta.home)

    await json<CodexLoginAttempt>(h.call('POST', `/${alpha.instance.id}/start-login`))
    h.fake.complete(alpha.home)
    await waitFor(() => status(alpha.instance.id), r => r.attempt?.status === 'succeeded')

    expect(await health(alpha.instance.id)).toMatchObject({ healthy: true })
    expect(await health(beta.instance.id)).toMatchObject({ healthy: false })
    expect((await status(beta.instance.id)).attempt).toBeNull()
    expect(codexLaunchContext(h.deps, alpha.project.id)).toMatchObject({ instanceId: alpha.instance.id, home: alpha.home, command: undefined, health: { healthy: true } })
    expect(codexLaunchContext(h.deps, beta.project.id)).toMatchObject({ home: beta.home, health: { healthy: false } })
  })

  it('fails start-login when the configured CLI cannot be started', async () => {
    h = harness({}, { codexPath: '/nonexistent/codex' })
    const { instance, project } = await h.project('alpha')
    const res = await h.call('POST', `/${instance.id}/start-login`)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: { code: 'codex_login_failed', message: expect.stringMatching(/could not be started/) } })
    expect(codexLaunchContext(h.deps, project.id)?.command).toBe('/nonexistent/codex')
    expect(await health(instance.id)).toMatchObject({ healthy: false, reason: expect.stringMatching(/could not be started/) })
  })

  it('runs the configured codexPath instead of codex on PATH', async () => {
    h = harness()
    vi.stubEnv('PATH', '/usr/bin:/bin')
    const project = await createProject(h.database.db, { name: 'alpha', slug: 'alpha', source: { kind: 'local-path', path: h.root } })
    const instance = createPluginInstance(h.deps, { type: 'codex', scope: 'project', projectId: project.id, config: { codexPath: h.fake.bin } })
    expect((await json<CodexLoginAttempt>(h.call('POST', `/${instance.id}/start-login`))).userCode).toBe(FAKE_USER_CODE)
  })

  it('ends open attempts on close', async () => {
    h = harness()
    const { instance, home } = await h.project('alpha')
    await json<CodexLoginAttempt>(h.call('POST', `/${instance.id}/start-login`))
    const pid = h.fake.loginPid(home)!
    await h.attempts.close()
    expect(alive(pid)).toBe(false)
    expect((await status(instance.id)).attempt).toMatchObject({ status: 'failed', failure: CODEX_LOGIN_FAILURES.stopped })
  })

  it('rejects a relative codexPath and a second instance per project', async () => {
    h = harness()
    const { project } = await h.project('alpha')
    expect(() => createPluginInstance(h!.deps, { type: 'codex', scope: 'project', projectId: project.id })).toThrow(/already has a Codex instance/)
    const beta = await createProject(h.database.db, { name: 'beta', slug: 'beta', source: { kind: 'local-path', path: h.root } })
    expect(() => createPluginInstance(h!.deps, { type: 'codex', scope: 'project', projectId: beta.id, config: { codexPath: 'codex' } })).toThrow(/codexPath/)
    expect(() => createPluginInstance(h!.deps, { type: 'codex', scope: 'global', projectId: null })).toThrow(/project scope only/)
  })
})

describe('codex CLI output', () => {
  it('parses the device prompt only once both the URL and the code are printed', () => {
    const head = '\u001B[1mWelcome\u001B[0m\n1. Open this link in your browser\n   \u001B[94mhttps://auth.openai.com/codex/device\u001B[0m\n\n'
    expect(parseDeviceAuthPrompt(head)).toBeUndefined()
    expect(parseDeviceAuthPrompt(`${head}2. Enter this one-time code (expires in 15 minutes)\n`)).toBeUndefined()
    expect(parseDeviceAuthPrompt(`${head}2. Enter this one-time code (expires in 15 minutes)\n   \u001B[94mWXYZ-9876\u001B[0m\n`)).toEqual({ verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'WXYZ-9876' })
  })

  it('reads login status without passing on a masked key', () => {
    expect(interpretCodexStatus(0, 'Logged in using ChatGPT\n')).toEqual({ state: 'logged_in', method: 'ChatGPT' })
    expect(interpretCodexStatus(0, 'Logged in using an API key - sk-proj-***abcd\n')).toEqual({ state: 'logged_in', method: 'an API key' })
    expect(interpretCodexStatus(1, 'Not logged in\n')).toEqual({ state: 'logged_out' })
    expect(interpretCodexStatus(1, 'Error: something broke\n')).toMatchObject({ state: 'unknown' })
  })
})
