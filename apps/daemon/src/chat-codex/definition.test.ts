import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECTS_PATH, type ApiErrorBody } from '@candy-mountain/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBins } from '../acp/test-support'
import { CapabilityDefinitionError } from '../capabilities/definition'
import { ACP_SESSIONS, chatClaudeCodeDefinition } from '../chat-claude-code/definition'
import { acpServices } from '../chat-claude-code/test-support'
import type { Platform } from '../platform'
import { CAPABILITY_DEFINITIONS, createTestApp, startTestPlatform, withoutCapabilities, type TestPlatformOptions } from '../testing/platform'
import { claudeLoginAttempts } from '../plugins/claude-code/login-attempts'
import { codexLoginAttempts } from '../plugins/codex/attempts'
import { PLUGIN_TYPES } from '../plugins/types'
import { createProject } from '../projects/projects'
import { SESSION_FAMILIES } from '../threads/families'
import { createTempDataDir, type TempDataDir } from '../testing'
import { chatCodexDefinition } from './definition'
import { codexLauncher } from './launcher'

const acp = { bins: fakeBins, killTimeoutMs: 1000 }

describe('the chat-codex definition', () => {
  let temp: TempDataDir
  let checkout: string | undefined
  const open: Platform[] = []

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    temp?.cleanup()
    if (checkout) rmSync(checkout, { recursive: true, force: true })
    checkout = undefined
    vi.restoreAllMocks()
  })

  const withAcp = (entries = CAPABILITY_DEFINITIONS) => entries.map(c => (c.id === 'chat-claude-code' ? chatClaudeCodeDefinition({ acp }) : c))

  function start(options: TestPlatformOptions = {}) {
    temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, { capabilities: withAcp(), ...options })
    open.push(platform)
    const app = createTestApp({ db: platform.db, paths: platform.paths, capabilities: platform.capabilities, modules: platform.modules, pluginTypes: platform.pluginTypes, families: platform.families, runtime: platform.runtime })
    return { platform, app }
  }

  const without = (...ids: string[]) => {
    const parts = withoutCapabilities(...ids)
    return { ...parts, capabilities: withAcp(parts.capabilities) }
  }

  async function codexSession(platform: Platform) {
    checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-chat-codex-'))
    const project = await createProject(platform.db, { name: 'alpha', slug: 'alpha', source: { kind: 'local-path', path: checkout } })
    const sessions = platform.runtime.service(ACP_SESSIONS)!
    return { sessions, session: sessions.create({ projectId: project.id, family: 'codex', actorId: 'actor', cwd: checkout }) }
  }

  it('brings the codex plugin type and family, which the platform no longer supplies itself', () => {
    const { platform } = start()

    expect(PLUGIN_TYPES.map(t => t.id)).not.toContain('codex')
    expect(SESSION_FAMILIES.map(f => f.id)).not.toContain('codex')
    expect(platform.pluginTypes.has('codex')).toBe(true)
    expect(platform.families.nameOf('codex')).toBe('Codex')
    expect(platform.families.ids()).toEqual(['claude-code', 'codex', 'platform'])
    expect(platform.runtime.started.map(s => s.definition.id).indexOf('chat-codex')).toBeGreaterThan(platform.runtime.started.map(s => s.definition.id).indexOf('chat-claude-code'))
  })

  it('registers the codex launcher on the session service', async () => {
    const { platform } = start()
    const { sessions, session } = await codexSession(platform)

    await expect(sessions.prompt(session.id, 'hello')).rejects.toMatchObject({ code: 'family_unavailable', message: 'The Codex plugin is not set up for this project.' })
    expect(() => sessions.registerLauncher('codex', codexLauncher)).toThrow("Session family 'codex' already has a launcher.")
  })

  it('boots without it: no codex plugin type or family, and a codex session is refused as unavailable', async () => {
    // Bots require the codex plugin type, so a product without chat-codex leaves them out too.
    const { platform, app } = start(without('chat-codex', 'bots'))

    expect(platform.capabilities.has('chat-codex')).toBe(false)
    expect(platform.pluginTypes.has('codex')).toBe(false)
    expect(platform.families.has('codex')).toBe(false)
    const { sessions, session } = await codexSession(platform)
    await expect(sessions.prompt(session.id, 'hello')).rejects.toMatchObject({ code: 'family_unavailable', message: 'No agent harness launches codex sessions.' })
    expect(() => sessions.registerLauncher('codex', codexLauncher)).toThrow("Cannot register a launcher for unregistered session family 'codex'.")

    const res = await app.request(`${PROJECTS_PATH}/alpha/sessions`, { method: 'POST', body: JSON.stringify({ family: 'codex' }), headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('invalid_request')
  })

  it('refuses a list with bots but without chat-codex, naming both', () => {
    temp = createTempDataDir()
    const { capabilities, modules } = without('chat-codex')
    expect(() => startTestPlatform(temp.root, { capabilities, modules })).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp.root, { capabilities, modules })).toThrow("Capability 'bots' depends on 'chat-codex', which is not in the definition list.")
  })

  it('refuses a list with chat-codex but without chat-claude-code, naming both', () => {
    temp = createTempDataDir()
    const options: TestPlatformOptions = { capabilities: [chatCodexDefinition()], modules: [] }
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
