import { WORKSPACES_PATH, type ApiErrorBody } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityDefinitionError, createTempDataDir, createWorkspace, type Platform, platformApp, SESSION_FAMILIES, startTestPlatform, type TempDataDir } from '@candy-mountain/platform-daemon'
import { ACP_SESSIONS, claudeLoginAttempts, fakeBins } from '@candy-mountain/cap-chat-claude-code'
import { codexLoginAttempts } from './plugin-type/attempts'
import { chatCodexDefinition } from './definition'
import { codexLauncher } from './launcher'
import { acpServices, startCodexPlatform } from './test-support'

const acp = { bins: fakeBins, killTimeoutMs: 1000 }

describe('the chat-codex definition', () => {
  let temp: TempDataDir
  const open: Platform[] = []

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    temp?.cleanup()
    vi.restoreAllMocks()
  })

  function start({ withCodex = true } = {}) {
    temp = createTempDataDir()
    const platform = startCodexPlatform(temp.root, { acp, withCodex })
    open.push(platform)
    return { platform, app: platformApp(platform) }
  }

  function codexSession(platform: Platform) {
    const project = createWorkspace(platform.db, { name: 'alpha', slug: 'alpha' })
    const sessions = platform.runtime.service(ACP_SESSIONS)!
    return { sessions, session: sessions.create({ workspaceId: project.id, family: 'codex', actorId: 'actor', cwd: temp.root }) }
  }

  it('brings the codex plugin type and family, which the platform does not supply itself', () => {
    const { platform } = start()

    expect(SESSION_FAMILIES.map(f => f.id)).not.toContain('codex')
    expect(platform.pluginTypes.has('codex')).toBe(true)
    expect(platform.families.nameOf('codex')).toBe('Codex')
    expect(platform.families.ids()).toEqual(['claude-code', 'codex'])
    expect(platform.runtime.started.map(s => s.definition.id).indexOf('chat-codex')).toBeGreaterThan(platform.runtime.started.map(s => s.definition.id).indexOf('chat-claude-code'))
  })

  it('registers the codex launcher on the session service', async () => {
    const { platform } = start()
    const { sessions, session } = codexSession(platform)

    await expect(sessions.prompt(session.id, 'hello')).rejects.toMatchObject({ code: 'family_unavailable', message: 'The Codex plugin is not set up for this project.' })
    expect(() => sessions.registerLauncher('codex', codexLauncher)).toThrow("Session family 'codex' already has a launcher.")
  })

  it('boots without it: no codex plugin type or family, and a codex session is refused as unavailable', async () => {
    const { platform, app } = start({ withCodex: false })

    expect(platform.capabilities.has('chat-codex')).toBe(false)
    expect(platform.pluginTypes.has('codex')).toBe(false)
    expect(platform.families.has('codex')).toBe(false)
    const { sessions, session } = codexSession(platform)
    await expect(sessions.prompt(session.id, 'hello')).rejects.toMatchObject({ code: 'family_unavailable', message: 'No agent harness launches codex sessions.' })
    expect(() => sessions.registerLauncher('codex', codexLauncher)).toThrow("Cannot register a launcher for unregistered session family 'codex'.")

    const res = await app.request(`${WORKSPACES_PATH}/alpha/sessions`, { method: 'POST', body: JSON.stringify({ family: 'codex' }), headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('invalid_request')
  })

  it('refuses a list with chat-codex but without chat-claude-code, naming both', () => {
    temp = createTempDataDir()
    const options = { capabilities: [chatCodexDefinition()], modules: [] }
    expect(() => startTestPlatform(temp.root, options)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp.root, options)).toThrow("Capability 'chat-codex' depends on 'chat-claude-code', which is not in the definition list.")
  })

  it('closes its login attempts before chat-claude-code closes the session service', async () => {
    const { platform } = start()
    const { sessions, decisions, acpHarness } = acpServices(platform)
    const order: string[] = []
    const record = <T extends object, K extends keyof T & string>(target: T, method: K, name: string) => {
      const original = (target[method] as unknown as (...args: unknown[]) => unknown).bind(target)
      vi.spyOn(target, method as never).mockImplementation(((...args: unknown[]) => {
        order.push(name)
        return original(...args)
      }) as never)
    }
    record(codexLoginAttempts, 'close', 'codex login attempts')
    record(decisions, 'close', 'decisions')
    record(sessions, 'close', 'sessions')
    record(acpHarness, 'close', 'harness')
    record(claudeLoginAttempts, 'close', 'claude login attempts')

    await platform.close()
    expect(order).toEqual(['codex login attempts', 'decisions', 'sessions', 'harness', 'claude login attempts'])
  })
})
