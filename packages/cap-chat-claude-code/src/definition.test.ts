import { WORKSPACES_PATH, type ApiErrorBody } from '@candy-mountain/platform-sdk'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { repositoryDefinition } from '@candy-mountain/cap-repository'
import { CapabilityDefinitionError, createTempDataDir, type Platform, platformApp, SESSION_FAMILIES, startTestPlatform, type TempDataDir, type TestPlatformOptions, THREAD_SESSIONS } from '@candy-mountain/platform-daemon'
import { fakeBins } from './acp/test-support'
import { ACP_DECISIONS, ACP_HARNESS, ACP_SESSIONS, chatClaudeCodeDefinition } from './definition'
import { claudeLoginAttempts } from './plugin-type/login-attempts'
import { acpServices, acpTestProduct } from './test-support'

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
    return { platform, app: platformApp(platform) }
  }

  const withAcp = (): TestPlatformOptions => ({ product: acpTestProduct({ acp: { bins: fakeBins, killTimeoutMs: 1000 } }) })

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
    // The stand-in dependent registered its family through the service, as chat-codex does.
    expect(platform.families.nameOf('codex')).toBe('Codex')
  })

  it('mounts the session, decision and thread routes under the workspace prefix', async () => {
    const { app } = start(withAcp())

    for (const path of ['sessions', 'sessions/s1/decisions', 'threads']) {
      const res = await app.request(`${WORKSPACES_PATH}/nope/${path}`)
      expect(res.status, path).toBe(404)
      expect(((await res.json()) as ApiErrorBody).error.code, path).toBe('not_found')
    }
  })

  it('boots without it: those routes answer not found, nothing claude-code is registered and threads are still served', async () => {
    const { platform, app } = start({ capabilities: [repositoryDefinition()] })

    expect(platform.runtime.service(ACP_SESSIONS)).toBeUndefined()
    expect(platform.runtime.service(THREAD_SESSIONS)).toBeDefined()
    expect(platform.pluginTypes.has('claude-code')).toBe(false)
    expect(platform.families.has('claude-code')).toBe(false)
    for (const path of ['sessions', 'sessions/s1/decisions']) {
      const res = await app.request(`${WORKSPACES_PATH}/nope/${path}`)
      expect(res.status, path).toBe(404)
      expect(await res.text(), path).toBe('404 Not Found')
    }
    const threads = await app.request(`${WORKSPACES_PATH}/nope/threads`)
    expect(threads.status).toBe(404)
    expect(((await threads.json()) as ApiErrorBody).error.code).toBe('not_found')
    expect((await app.request(WORKSPACES_PATH)).status).toBe(200)
  })

  it('refuses to boot without the repository capability its sessions run in', () => {
    temp = createTempDataDir()
    expect(() => startTestPlatform(temp.root, { capabilities: [chatClaudeCodeDefinition()] })).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp.root, { capabilities: [chatClaudeCodeDefinition()] })).toThrow("Capability 'chat-claude-code' depends on 'repository', which is not in the definition list.")
  })

  it('refuses a product that already supplies the claude-code family or plugin type', () => {
    temp = createTempDataDir()
    const families = [...SESSION_FAMILIES, { id: 'claude-code', name: 'Claude Code' }]
    expect(() => startTestPlatform(temp.root, { ...withAcp(), families })).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp.root, { ...withAcp(), families })).toThrow("Session family 'claude-code' is registered by capability 'chat-claude-code' but the product already supplies it.")
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
