import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CLAUDE_CODE_ACTIONS,
  CLAUDE_CODE_LOGIN_ATTEMPT_TTL_MS,
  PLUGINS_PATH,
  PROJECTS_PATH,
  type ClaudeCodeRevokeResponse,
  type ClaudeCodeStartLoginResponse,
  type ClaudeCodeSubmitCodeResponse,
  type PluginInstance,
  type PluginInstanceResponse,
} from '@candy-mountain/shared'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { dataPaths } from '../../data-dir'
import { startPlatform } from '../../platform'
import { createTempDataDir } from '../../testing'
import { instanceHarness, type InstanceHarness } from '../instances/test-support'
import { claudeCodePluginType } from '../types/claude-code'
import { claudeConfigDir } from './cli'
import { claudeCodeLaunchContext, ClaudeCodeLaunchError } from './launch'
import { claudeLoginAttempts, isPlausibleCode, LOGIN_FAILURES, LoginAttemptRegistry, parseLoginUrl } from './login-attempts'

const FAKE = fileURLToPath(new URL('./test-support/fake-claude.mjs', import.meta.url))
const LOGIN_URL = 'https://claude.ai/oauth/authorize?code=true&state=s1'
const GOOD_CODE = 'good#state'

/** A `claude` on disk that runs the fake with a baked-in environment, since the daemon curates what the child inherits. */
function fakeClaude(dir: string, env: Record<string, string> = {}): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'claude')
  const exports = Object.entries(env).map(([name, value]) => `${name}='${value}'`).join(' ')
  writeFileSync(path, `#!/bin/sh\n${exports} exec '${process.execPath}' '${FAKE}' "$@"\n`)
  chmodSync(path, 0o755)
  return path
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}
async function expectGone(pid: number) {
  for (let i = 0; i < 40 && alive(pid); i++) await sleep(50)
  expect(alive(pid)).toBe(false)
}
const fakeEnv = (configDir: string) => JSON.parse(readFileSync(join(configDir, 'fake-env.json'), 'utf8')) as { pid: number, apiKey: boolean, oauthToken: boolean, authEnv: string[] }

let scratch: string
let originalPath: string | undefined
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'candy-mountain-claude-code-'))
  fakeClaude(join(scratch, 'bin'))
  originalPath = process.env.PATH
  process.env.PATH = `${join(scratch, 'bin')}:${originalPath ?? ''}`
  process.env.ANTHROPIC_API_KEY = 'sk-ant-must-not-reach-the-cli'
})
afterAll(() => {
  process.env.PATH = originalPath
  delete process.env.ANTHROPIC_API_KEY
  rmSync(scratch, { recursive: true, force: true })
})

let h: InstanceHarness
afterEach(() => {
  claudeLoginAttempts.close()
  h?.close()
})

const root = () => dirname(h.secretsDir)
const configDirOf = (instance: PluginInstance) => claudeConfigDir(dataPaths(root()), instance.id)

function call(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method }
  if (body !== undefined) init.headers = { 'content-type': 'application/json' }
  if (body !== undefined) init.body = JSON.stringify(body)
  return h.app().request(`${PLUGINS_PATH}${path}`, init)
}

async function instanceFor(project: string, body: Record<string, unknown> = {}): Promise<PluginInstance> {
  await h.createProject(project)
  const res = await call('POST', '', { type: 'claude-code', scope: 'project', project, ...body })
  expect(res.status, await res.clone().text()).toBe(201)
  return (await res.json() as PluginInstanceResponse).instance
}

async function act<T>(instance: PluginInstance, action: string, body: unknown = {}, status = 200): Promise<T> {
  const res = await call('POST', `/${instance.id}/${action}`, body)
  expect(res.status, await res.clone().text()).toBe(status)
  return await res.json() as T
}

async function health(instance: PluginInstance) {
  const res = await call('POST', `/${instance.id}/test`)
  expect(res.status).toBe(200)
  return (await res.json() as PluginInstanceResponse).instance.health
}

async function stored(instance: PluginInstance) {
  const res = await call('GET', `/${instance.id}`)
  expect(res.status).toBe(200)
  return (await res.json() as PluginInstanceResponse).instance.health
}

const startLogin = (instance: PluginInstance) => act<ClaudeCodeStartLoginResponse>(instance, CLAUDE_CODE_ACTIONS.startLogin)
const submitCode = (instance: PluginInstance, attemptId: string, code: string) => act<ClaudeCodeSubmitCodeResponse>(instance, CLAUDE_CODE_ACTIONS.submitCode, { attemptId, code })

describe('claude-code browser login', () => {
  it('captures the sign-in link, and the pasted code logs the instance in', async () => {
    h = instanceHarness([claudeCodePluginType])
    const instance = await instanceFor('alpha')
    expect(await health(instance)).toMatchObject({ healthy: false, reason: 'Not logged in; start the browser login.' })

    const before = Date.now()
    const started = await startLogin(instance)
    expect(started.url).toBe(LOGIN_URL)
    expect(started.attemptId).toMatch(/^[0-9a-f-]{36}$/)
    const expiresIn = Date.parse(started.expiresAt) - before
    expect(expiresIn).toBeGreaterThan(CLAUDE_CODE_LOGIN_ATTEMPT_TTL_MS - 5_000)
    expect(expiresIn).toBeLessThanOrEqual(CLAUDE_CODE_LOGIN_ATTEMPT_TTL_MS + 5_000)

    const configDir = configDirOf(instance)
    expect(configDir).toBe(join(root(), 'agent-homes', 'claude-code', instance.id))
    expect(statSync(configDir).mode & 0o777).toBe(0o700)
    expect(fakeEnv(configDir)).toMatchObject({ apiKey: false, oauthToken: false, authEnv: [] })

    expect(await submitCode(instance, started.attemptId, GOOD_CODE)).toEqual({ attemptId: started.attemptId, status: 'logged_in' })
    expect(await stored(instance)).toMatchObject({ healthy: true, detail: 'Logged in as owner@example.com (Claude Max) via claude.ai.' })
  })

  it('reports a wrong code as a failure and stays logged out', async () => {
    h = instanceHarness([claudeCodePluginType])
    const instance = await instanceFor('alpha')
    const started = await startLogin(instance)
    expect(await submitCode(instance, started.attemptId, 'wrong#state')).toEqual({ attemptId: started.attemptId, status: 'failed', reason: LOGIN_FAILURES.codeRejected })
    expect(await stored(instance)).toMatchObject({ healthy: false, reason: 'Not logged in; start the browser login.' })
    // The failed attempt is still known, so a second paste gets a reason rather than a 404.
    const again = await call('POST', `/${instance.id}/${CLAUDE_CODE_ACTIONS.submitCode}`, { attemptId: started.attemptId, code: GOOD_CODE })
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ error: { code: 'claude_code_attempt_not_waiting' } })
  })

  it('refuses a malformed code without ending the attempt', async () => {
    h = instanceHarness([claudeCodePluginType])
    const instance = await instanceFor('alpha')
    const started = await startLogin(instance)
    const bad = await call('POST', `/${instance.id}/${CLAUDE_CODE_ACTIONS.submitCode}`, { attemptId: started.attemptId, code: 'no-state-half' })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: { code: 'claude_code_invalid_code' } })
    expect((await call('POST', `/${instance.id}/${CLAUDE_CODE_ACTIONS.submitCode}`, { attemptId: started.attemptId })).status).toBe(400)
    expect(await submitCode(instance, started.attemptId, GOOD_CODE)).toMatchObject({ status: 'logged_in' })
  })

  it('returns the open attempt again and keeps attempts per instance', async () => {
    h = instanceHarness([claudeCodePluginType])
    const alpha = await instanceFor('alpha')
    const beta = await instanceFor('beta')
    const started = await startLogin(alpha)
    expect(await startLogin(alpha)).toEqual(started)

    const foreign = await call('POST', `/${beta.id}/${CLAUDE_CODE_ACTIONS.submitCode}`, { attemptId: started.attemptId, code: GOOD_CODE })
    expect(foreign.status).toBe(404)
    expect(await foreign.json()).toMatchObject({ error: { code: 'claude_code_attempt_not_found' } })
    expect((await call('POST', `/${alpha.id}/${CLAUDE_CODE_ACTIONS.submitCode}`, { attemptId: 'nope', code: GOOD_CODE })).status).toBe(404)
  })

  it('gives each project its own config directory', async () => {
    h = instanceHarness([claudeCodePluginType])
    const alpha = await instanceFor('alpha')
    const beta = await instanceFor('beta')
    expect(configDirOf(alpha)).not.toBe(configDirOf(beta))

    const started = await startLogin(alpha)
    await submitCode(alpha, started.attemptId, GOOD_CODE)
    expect(await health(alpha)).toMatchObject({ healthy: true })
    expect(await health(beta)).toMatchObject({ healthy: false })
    expect(existsSync(configDirOf(beta))).toBe(false)
  })

  it('drives the executable named in claudePath', async () => {
    h = instanceHarness([claudeCodePluginType])
    const broken = fakeClaude(join(scratch, 'broken'), { FAKE_CLAUDE_MODE: 'exit-early' })
    const instance = await instanceFor('alpha', { config: { claudePath: broken } })
    const res = await call('POST', `/${instance.id}/${CLAUDE_CODE_ACTIONS.startLogin}`)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: { code: 'claude_code_login_failed', message: LOGIN_FAILURES.noPrompt } })
  })
})

describe('claude-code long-lived token', () => {
  it('is healthy with a token injected as CLAUDE_CODE_OAUTH_TOKEN and never echoes it', async () => {
    h = instanceHarness([claudeCodePluginType])
    const instance = await instanceFor('alpha', { config: { authMode: 'token' }, secrets: { oauthToken: 'tok-secret-123' } })
    expect(instance.secrets).toEqual({ oauthToken: 'set' })
    const result = await health(instance)
    expect(result).toMatchObject({ healthy: true, detail: 'Logged in (Claude Max) via oauth_token.' })
    expect(JSON.stringify(result)).not.toContain('tok-secret-123')
    expect(fakeEnv(configDirOf(instance))).toMatchObject({ apiKey: false, oauthToken: true })

    const refused = await call('POST', `/${instance.id}/${CLAUDE_CODE_ACTIONS.startLogin}`)
    expect(refused.status).toBe(409)
  })

  it('is unhealthy without a token or with one claude rejects', async () => {
    h = instanceHarness([claudeCodePluginType])
    const missing = await instanceFor('alpha', { config: { authMode: 'token' } })
    expect(await health(missing)).toMatchObject({ healthy: false, reason: expect.stringContaining('No long-lived token is set') })
    const rejected = await instanceFor('beta', { config: { authMode: 'token' }, secrets: { oauthToken: 'bad-token' } })
    expect(await health(rejected)).toMatchObject({ healthy: false, reason: expect.stringContaining('does not accept the stored token') })
  })
})

describe('claude-code revoke', () => {
  it('ends the open attempt and deletes the config directory', async () => {
    h = instanceHarness([claudeCodePluginType])
    const instance = await instanceFor('alpha')
    const started = await startLogin(instance)
    const configDir = configDirOf(instance)
    const { pid } = fakeEnv(configDir)

    expect(await act<ClaudeCodeRevokeResponse>(instance, CLAUDE_CODE_ACTIONS.revoke)).toEqual({ directoryRemoved: true, tokenCleared: false })
    expect(existsSync(configDir)).toBe(false)
    await expectGone(pid)
    const late = await call('POST', `/${instance.id}/${CLAUDE_CODE_ACTIONS.submitCode}`, { attemptId: started.attemptId, code: GOOD_CODE })
    expect(late.status).toBe(409)
    expect(await late.json()).toMatchObject({ error: { message: expect.stringContaining(LOGIN_FAILURES.cancelled) } })
    expect(await act<ClaudeCodeRevokeResponse>(instance, CLAUDE_CODE_ACTIONS.revoke)).toEqual({ directoryRemoved: false, tokenCleared: false })
  })

  it('stores unhealthy after revoking a browser login', async () => {
    h = instanceHarness([claudeCodePluginType])
    const instance = await instanceFor('alpha')
    await submitCode(instance, (await startLogin(instance)).attemptId, GOOD_CODE)
    expect(await stored(instance)).toMatchObject({ healthy: true })
    await act<ClaudeCodeRevokeResponse>(instance, CLAUDE_CODE_ACTIONS.revoke)
    expect(await stored(instance)).toMatchObject({ healthy: false, reason: 'Not logged in; start the browser login.' })
  })

  it('clears the stored token and stores unhealthy', async () => {
    h = instanceHarness([claudeCodePluginType])
    const instance = await instanceFor('alpha', { config: { authMode: 'token' }, secrets: { oauthToken: 'tok-secret-123' } })
    expect(await health(instance)).toMatchObject({ healthy: true })
    expect(await act<ClaudeCodeRevokeResponse>(instance, CLAUDE_CODE_ACTIONS.revoke)).toEqual({ directoryRemoved: true, tokenCleared: true })
    const after = (await (await call('GET', `/${instance.id}`)).json() as PluginInstanceResponse).instance
    expect(after.secrets).toEqual({ oauthToken: 'unset' })
    expect(after.health).toMatchObject({ healthy: false, reason: expect.stringContaining('No long-lived token is set') })
    expect(h.store.isSet(`plugin:${instance.id}`, 'oauthToken')).toBe(false)
  })
})

describe('deleting a claude-code instance', () => {
  it('ends the open attempt and removes the config directory', async () => {
    h = instanceHarness([claudeCodePluginType])
    const instance = await instanceFor('alpha')
    await startLogin(instance)
    const configDir = configDirOf(instance)
    const { pid } = fakeEnv(configDir)
    expect((await call('DELETE', `/${instance.id}`)).status).toBe(204)
    expect(existsSync(configDir)).toBe(false)
    await expectGone(pid)
  })

  it('removes the config directory with its project', async () => {
    h = instanceHarness([claudeCodePluginType])
    const instance = await instanceFor('alpha')
    await submitCode(instance, (await startLogin(instance)).attemptId, GOOD_CODE)
    const kept = await instanceFor('beta')
    await startLogin(kept)
    expect((await h.app().request(`${PROJECTS_PATH}/alpha`, { method: 'DELETE' })).status).toBe(204)
    expect(existsSync(configDirOf(instance))).toBe(false)
    expect(existsSync(configDirOf(kept))).toBe(true)
  })
})

describe('claude-code login attempt registry', () => {
  let registry: LoginAttemptRegistry
  afterEach(() => registry?.close())

  it('expires an attempt after its ttl and ends the process', async () => {
    registry = new LoginAttemptRegistry({ ttlMs: 300, killGraceMs: 200 })
    const configDir = join(scratch, 'expiry')
    const attempt = await registry.start({ instanceId: 'i1', configDir })
    expect(attempt).toMatchObject({ status: 'waiting', url: LOGIN_URL })
    const { pid } = fakeEnv(configDir)
    expect(alive(pid)).toBe(true)
    await sleep(700)
    expect(registry.get(attempt.id)).toBeUndefined()
    expect(await registry.submitCode(attempt.id, GOOD_CODE)).toEqual({ outcome: 'not_found' })
    await expectGone(pid)
  })

  it('fails an attempt whose CLI never shows a link', async () => {
    registry = new LoginAttemptRegistry({ promptTimeoutMs: 200, killGraceMs: 200 })
    const configDir = join(scratch, 'no-url')
    const silent = fakeClaude(join(scratch, 'silent'), { FAKE_CLAUDE_MODE: 'no-url' })
    const attempt = await registry.start({ instanceId: 'i2', configDir, command: silent })
    expect(attempt).toMatchObject({ status: 'failed', failure: LOGIN_FAILURES.noPrompt })
    await expectGone(fakeEnv(configDir).pid)
  })

  it('is closed by Platform.close', async () => {
    const temp = createTempDataDir()
    const configDir = join(scratch, 'platform')
    try {
      const attempt = await claudeLoginAttempts.start({ instanceId: 'i3', configDir })
      expect(attempt.status).toBe('waiting')
      const platform = startPlatform(temp.root)
      expect(platform.pluginTypes.has('claude-code')).toBe(true)
      platform.close()
      expect(claudeLoginAttempts.get(attempt.id)).toBeUndefined()
      await expectGone(fakeEnv(configDir).pid)
    }
    finally {
      temp.cleanup()
    }
  })

  it('unwraps OSC 8 links and prefers the paste-back variant', () => {
    expect(parseLoginUrl('visit: \u001B]8;;https://a.example/x?code=true\u0007link\u001B]8;;\u0007')).toBe('https://a.example/x?code=true')
    expect(parseLoginUrl('https://a.example/one\nhttps://a.example/two?code=true&state=s')).toBe('https://a.example/two?code=true&state=s')
    expect(parseLoginUrl('Opening browser…')).toBeUndefined()
    expect(isPlausibleCode('abc#state')).toBe(true)
    for (const code of ['', 'abc', '#state', 'abc#', 'a#b#c', 'ab c#d', 'a\nb#c']) expect(isPlausibleCode(code), code).toBe(false)
  })
})

describe('claudeCodeLaunchContext', () => {
  it('hands a launcher the config directory and token env without running the CLI', async () => {
    h = instanceHarness([claudeCodePluginType])
    const paths = dataPaths(root())
    const deps = { ...h.deps, paths }
    const alpha = await h.createProject('alpha')
    expect(claudeCodeLaunchContext(deps, alpha.id)).toBeNull()

    const beta = await instanceFor('beta')
    const loginContext = claudeCodeLaunchContext(deps, beta.projectId!)
    expect(loginContext).toMatchObject({ configDir: claudeConfigDir(paths, beta.id), command: undefined, env: {} })
    expect(statSync(loginContext!.configDir).mode & 0o777).toBe(0o700)
    expect(existsSync(join(loginContext!.configDir, 'fake-env.json'))).toBe(false)

    const token = await instanceFor('gamma', { config: { authMode: 'token', claudePath: '/opt/claude' }, secrets: { oauthToken: 'tok-secret-123' } })
    expect(claudeCodeLaunchContext(deps, token.projectId!)).toMatchObject({ command: '/opt/claude', env: { CLAUDE_CODE_OAUTH_TOKEN: 'tok-secret-123' } })

    const bare = await instanceFor('delta', { config: { authMode: 'token' } })
    expect(() => claudeCodeLaunchContext(deps, bare.projectId!)).toThrow(ClaudeCodeLaunchError)
  })
})
