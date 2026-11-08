import { WORKSPACES_PATH, type ApiErrorBody } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityDefinitionError, createTempDataDir, createWorkspace, type Platform, platformApp, SESSION_FAMILIES, startTestPlatform, type TempDataDir } from '@candy-mountain/platform-daemon'
import { ACP_DECISIONS, ACP_HARNESS, ACP_SESSIONS, fakeBins } from '@candy-mountain/cap-acp'
import { claudeLoginAttempts } from './plugin-type/login-attempts'
import { claudeCodeDefinition } from './definition'
import { claudeCodeLauncher } from './launcher'
import { startClaudeCodePlatform } from './test-support'

const acp = { bins: fakeBins, killTimeoutMs: 1000 }

describe('the claude-code definition', () => {
  let temp: TempDataDir
  const open: Platform[] = []

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    temp?.cleanup()
    vi.restoreAllMocks()
  })

  function start({ withClaudeCode = true } = {}) {
    temp = createTempDataDir()
    const platform = startClaudeCodePlatform(temp.root, { acp, withClaudeCode })
    open.push(platform)
    return { platform, app: platformApp(platform) }
  }

  function claudeCodeSession(platform: Platform) {
    const project = createWorkspace(platform.db, { name: 'alpha', slug: 'alpha' })
    const sessions = platform.runtime.service(ACP_SESSIONS)!
    return { sessions, session: sessions.create({ workspaceId: project.id, family: 'claude-code', actorId: 'actor', cwd: temp.root }) }
  }

  it('is service-only and brings the claude-code plugin type and family, which the platform does not supply itself', () => {
    const { platform } = start()

    expect(claudeCodeDefinition().manifest).toBeUndefined()
    expect(SESSION_FAMILIES.map(f => f.id)).not.toContain('claude-code')
    expect(platform.capabilities.has('claude-code')).toBe(false)
    expect(platform.pluginTypes.has('claude-code')).toBe(true)
    expect(platform.families.nameOf('claude-code')).toBe('Claude Code')
    expect(platform.families.ids()).toEqual(['claude-code'])
  })

  it('registers the claude-code launcher on the session service', async () => {
    const { platform } = start()
    const { sessions, session } = claudeCodeSession(platform)

    await expect(sessions.prompt(session.id, 'hello')).rejects.toMatchObject({ code: 'family_unavailable', message: 'The Claude Code plugin is not set up for this project.' })
    expect(() => sessions.registerLauncher('claude-code', claudeCodeLauncher)).toThrow("Session family 'claude-code' already has a launcher.")
  })

  it('boots without it: no claude-code plugin type or family, and a claude-code session is refused as unavailable', async () => {
    const { platform, app } = start({ withClaudeCode: false })

    expect(platform.pluginTypes.has('claude-code')).toBe(false)
    expect(platform.families.has('claude-code')).toBe(false)
    const { sessions, session } = claudeCodeSession(platform)
    await expect(sessions.prompt(session.id, 'hello')).rejects.toMatchObject({ code: 'family_unavailable', message: 'No agent harness launches claude-code sessions.' })
    expect(() => sessions.registerLauncher('claude-code', claudeCodeLauncher)).toThrow("Cannot register a launcher for unregistered session family 'claude-code'.")

    const res = await app.request(`${WORKSPACES_PATH}/alpha/sessions`, { method: 'POST', body: JSON.stringify({ family: 'claude-code' }), headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('invalid_request')
  })

  it('depends on acp and nothing else', () => {
    temp = createTempDataDir()
    expect(claudeCodeDefinition().dependsOn).toEqual(['acp'])
    const withoutAcp = { capabilities: [claudeCodeDefinition()], modules: [] }
    expect(() => startTestPlatform(temp.root, withoutAcp)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp.root, withoutAcp)).toThrow("Capability 'claude-code' depends on 'acp', which is not in the definition list.")
  })

  it('refuses a product that already supplies the claude-code family', () => {
    temp = createTempDataDir()
    const families = [...SESSION_FAMILIES, { id: 'claude-code', name: 'Claude Code' }]
    expect(() => startClaudeCodePlatform(temp.root, { acp, families })).toThrow(CapabilityDefinitionError)
    expect(() => startClaudeCodePlatform(temp.root, { acp, families })).toThrow("Session family 'claude-code' is registered by capability 'claude-code' but the product already supplies it.")
  })

  it('closes its login attempts before acp closes decisions, sessions and the harness', async () => {
    const { platform } = start()
    const sessions = platform.runtime.service(ACP_SESSIONS)!
    const decisions = platform.runtime.service(ACP_DECISIONS)!
    const acpHarness = platform.runtime.service(ACP_HARNESS)!
    const order: string[] = []
    const record = <T extends object, K extends keyof T & string>(target: T, method: K, name: string) => {
      const original = (target[method] as unknown as (...args: unknown[]) => unknown).bind(target)
      vi.spyOn(target, method as never).mockImplementation(((...args: unknown[]) => {
        order.push(name)
        return original(...args)
      }) as never)
    }
    record(claudeLoginAttempts, 'close', 'login attempts')
    record(decisions, 'close', 'decisions')
    record(sessions, 'close', 'sessions')
    record(acpHarness, 'close', 'harness')

    await platform.close()
    expect(order).toEqual(['login attempts', 'decisions', 'sessions', 'harness'])
  })
})
