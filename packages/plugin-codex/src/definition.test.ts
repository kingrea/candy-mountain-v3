import { WORKSPACES_PATH, type ApiErrorBody } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityDefinitionError, SESSION_FAMILIES } from '@candy-mountain/platform-daemon'
import { testKit, testProduct, type TestKit } from '@candy-mountain/platform-daemon/testing'
import { ACP_DECISIONS, ACP_HARNESS, ACP_SESSIONS, fakeBins } from '@candy-mountain/cap-acp'
import { codexLoginAttempts } from './plugin-type/attempts'
import { codexDefinition } from './definition'
import { codexLauncher } from './launcher'
import { codexTestCapabilities } from './test-support'

const acp = { bins: fakeBins, killTimeoutMs: 1000 }

describe('the codex definition', () => {
  let kit: TestKit | undefined

  afterEach(async () => {
    await kit?.close()
    kit = undefined
    vi.restoreAllMocks()
  })

  function start({ withCodex = true } = {}) {
    kit = testKit({ product: testProduct({ capabilities: codexTestCapabilities(acp, { withCodex }) }) })
    return { platform: kit.platform, app: kit.admin }
  }

  function codexSession() {
    const project = kit!.workspace({ name: 'alpha', slug: 'alpha' })
    const sessions = kit!.platform.runtime.service(ACP_SESSIONS)!
    return { sessions, session: sessions.create({ workspaceId: project.id, family: 'codex', actorId: 'actor', cwd: kit!.platform.paths.root }) }
  }

  it('is service-only and brings the codex plugin type and family, which the platform does not supply itself', () => {
    const { platform } = start()

    expect(codexDefinition().manifest).toBeUndefined()
    expect(SESSION_FAMILIES.map(f => f.id)).not.toContain('codex')
    expect(platform.capabilities.has('codex')).toBe(false)
    expect(platform.pluginTypes.has('codex')).toBe(true)
    expect(platform.families.nameOf('codex')).toBe('Codex')
    expect(platform.families.ids()).toEqual(['claude-code', 'codex'])
  })

  it('registers the codex launcher on the session service', async () => {
    start()
    const { sessions, session } = codexSession()

    await expect(sessions.prompt(session.id, 'hello')).rejects.toMatchObject({ code: 'family_unavailable', message: 'The Codex plugin is not set up for this project.' })
    expect(() => sessions.registerLauncher('codex', codexLauncher)).toThrow("Session family 'codex' already has a launcher.")
  })

  it('boots without it: no codex plugin type or family, and a codex session is refused as unavailable', async () => {
    const { platform, app } = start({ withCodex: false })

    expect(platform.pluginTypes.has('codex')).toBe(false)
    expect(platform.families.has('codex')).toBe(false)
    const { sessions, session } = codexSession()
    await expect(sessions.prompt(session.id, 'hello')).rejects.toMatchObject({ code: 'family_unavailable', message: 'No agent harness launches codex sessions.' })
    expect(() => sessions.registerLauncher('codex', codexLauncher)).toThrow("Cannot register a launcher for unregistered session family 'codex'.")

    const res = await app.request(`${WORKSPACES_PATH}/alpha/sessions`, { method: 'POST', body: JSON.stringify({ family: 'codex' }), headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('invalid_request')
  })

  it('depends on acp and nothing else', () => {
    expect(codexDefinition().dependsOn).toEqual(['acp'])
    const withoutAcp = { capabilities: [codexDefinition()], modules: [] }
    expect(() => testKit(withoutAcp)).toThrow(CapabilityDefinitionError)
    expect(() => testKit(withoutAcp)).toThrow("Capability 'codex' depends on 'acp', which is not in the definition list.")
  })

  it('closes its login attempts before acp closes the session service', async () => {
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
    record(codexLoginAttempts, 'close', 'codex login attempts')
    record(decisions, 'close', 'decisions')
    record(sessions, 'close', 'sessions')
    record(acpHarness, 'close', 'harness')

    await platform.close()
    expect(order).toEqual(['codex login attempts', 'decisions', 'sessions', 'harness'])
  })
})
