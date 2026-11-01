import { PROJECTS_PATH, type ApiErrorBody } from '@candy-mountain/shared'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBins } from '../acp/test-support'
import { BOT_SESSIONS, BOT_SLACK_ROUTER } from '../bots/definition'
import { CapabilityDefinitionError } from '../capabilities/definition'
import type { Platform } from '../platform'
import { CAPABILITY_DEFINITIONS, createTestApp, startTestPlatform, withoutCapabilities, type TestPlatformOptions } from '../testing/platform'
import { claudeLoginAttempts } from '../plugins/claude-code/login-attempts'
import { SESSION_FAMILIES } from '../threads/families'
import { createTempDataDir, type TempDataDir } from '../testing'
import { THREAD_SESSIONS } from '../threads/sessions'
import { ACP_DECISIONS, ACP_HARNESS, ACP_SESSIONS, chatClaudeCodeDefinition } from './definition'
import { acpServices } from './test-support'

describe('the chat-claude-code definition', () => {
  let temp: TempDataDir
  const open: Platform[] = []

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    temp?.cleanup()
  })

  function start(options: TestPlatformOptions = {}) {
    temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, options)
    open.push(platform)
    const app = createTestApp({ db: platform.db, paths: platform.paths, capabilities: platform.capabilities, modules: platform.modules, pluginTypes: platform.pluginTypes, families: platform.families, runtime: platform.runtime })
    return { platform, app }
  }

  const withAcp = (): TestPlatformOptions => ({ capabilities: CAPABILITY_DEFINITIONS.map(c => (c.id === 'chat-claude-code' ? chatClaudeCodeDefinition({ acp: { bins: fakeBins, killTimeoutMs: 1000 } }) : c)) })

  it('offers the session service to the platform and to dependents, brings the plugin type and registers the family', () => {
    const { platform } = start(withAcp())

    const sessions = platform.runtime.service(ACP_SESSIONS)
    expect(sessions).toBeDefined()
    // The platform's own store under it, not the manager itself.
    expect(platform.runtime.service(THREAD_SESSIONS)).toBeDefined()
    expect(platform.runtime.service(THREAD_SESSIONS)).not.toBe(sessions)
    expect(platform.runtime.services('chat-claude-code').has(THREAD_SESSIONS)).toBe(false)
    expect(platform.runtime.service(ACP_HARNESS)?.closed).toBe(false)
    expect(platform.runtime.service(ACP_DECISIONS)).toBeDefined()
    expect(platform.runtime.services('chat-claude-code').has(ACP_SESSIONS)).toBe(true)
    expect(platform.pluginTypes.has('claude-code')).toBe(true)
    expect(platform.families.nameOf('claude-code')).toBe('Claude Code')
    expect(platform.runtime.service(BOT_SESSIONS)).toBeDefined()
    expect(platform.runtime.service(BOT_SLACK_ROUTER)).toBeDefined()
  })

  it('mounts the session, decision and thread routes under the workspace prefix', async () => {
    const { app } = start(withAcp())

    for (const path of ['sessions', 'sessions/s1/decisions', 'threads']) {
      const res = await app.request(`${PROJECTS_PATH}/nope/${path}`)
      expect(res.status, path).toBe(404)
      expect(((await res.json()) as ApiErrorBody).error.code, path).toBe('not_found')
    }
  })

  it('boots without it: those routes answer not found, nothing claude-code is registered, threads are still served, and bots and Slack routing stay off', async () => {
    // Bots and chat-codex depend on chat-claude-code, so a product without it leaves them out too.
    const { platform, app } = start(withoutCapabilities('chat-claude-code', 'bots', 'chat-codex'))

    expect(platform.runtime.service(ACP_SESSIONS)).toBeUndefined()
    expect(platform.runtime.service(THREAD_SESSIONS)).toBeDefined()
    expect(platform.pluginTypes.has('claude-code')).toBe(false)
    expect(platform.families.has('claude-code')).toBe(false)
    expect(platform.capabilities.has('uptime')).toBe(true)
    expect(platform.runtime.service(BOT_SESSIONS)).toBeUndefined()
    expect(platform.runtime.service(BOT_SLACK_ROUTER)).toBeUndefined()
    for (const path of ['sessions', 'sessions/s1/decisions']) {
      const res = await app.request(`${PROJECTS_PATH}/nope/${path}`)
      expect(res.status, path).toBe(404)
      expect(await res.text(), path).toBe('404 Not Found')
    }
    const threads = await app.request(`${PROJECTS_PATH}/nope/threads`)
    expect(threads.status).toBe(404)
    expect(((await threads.json()) as ApiErrorBody).error.code).toBe('not_found')
    expect((await app.request(PROJECTS_PATH)).status).toBe(200)
  })

  it('refuses a product that already supplies the claude-code family or plugin type', () => {
    temp = createTempDataDir()
    expect(() => startTestPlatform(temp.root, { families: [...SESSION_FAMILIES, { id: 'claude-code', name: 'Claude Code' }] })).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp.root, { families: [...SESSION_FAMILIES, { id: 'claude-code', name: 'Claude Code' }] })).toThrow("Session family 'claude-code' is registered by capability 'chat-claude-code' but the product already supplies it.")
  })

  it('closes decisions, then sessions, then the harness, then the login attempts, and the platform waits for it before shutting the database', async () => {
    const { platform } = start(withAcp())
    const { sessions, decisions, acpHarness } = acpServices(platform)
    const order: string[] = []
    const record = <T extends object, K extends keyof T & string>(target: T, method: K, name: string) => {
      const original = (target[method] as unknown as (...args: unknown[]) => unknown).bind(target)
      vi.spyOn(target, method as never).mockImplementation(((...args: unknown[]) => {
        order.push(name)
        return original(...args)
      }) as never)
    }
    record(decisions, 'close', 'decisions')
    record(sessions, 'close', 'sessions')
    record(acpHarness, 'close', 'harness')
    record(claudeLoginAttempts, 'close', 'login attempts')

    const closing = platform.close()
    expect(() => platform.db.get(sql`select 1`)).not.toThrow()
    await closing
    expect(order).toEqual(['decisions', 'sessions', 'harness', 'login attempts'])
    expect(acpHarness.closed).toBe(true)
    expect(sessions.signal.aborted).toBe(true)
    expect(() => platform.db.get(sql`select 1`)).toThrow(/not open/)
    vi.restoreAllMocks()
  })
})
