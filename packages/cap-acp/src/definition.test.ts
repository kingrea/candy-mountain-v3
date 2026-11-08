import { WORKSPACES_PATH, type ApiErrorBody } from '@candy-mountain/platform-sdk'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { repositoryDefinition } from '@candy-mountain/plugin-repository'
import { CapabilityDefinitionError, THREAD_SESSIONS } from '@candy-mountain/platform-daemon'
import { testKit, type TestKit, type TestKitOptions } from '@candy-mountain/platform-daemon/testing'
import { fakeBins } from './acp/test-support'
import { ACP_DECISIONS, ACP_HARNESS, ACP_SESSIONS, acpDefinition } from './definition'
import { acpServices, acpTestProduct } from './test-support'

describe('the acp definition', () => {
  let kit: TestKit | undefined

  afterEach(async () => {
    await kit?.close()
    kit = undefined
  })

  function start(options: TestKitOptions = {}) {
    kit = testKit(options)
    return { platform: kit.platform, app: kit.admin }
  }

  const withAcp = (): TestKitOptions => ({ product: acpTestProduct({ acp: { bins: fakeBins, killTimeoutMs: 1000 } }) })

  it('offers the session, harness and decision services to the platform and to dependents, and brings no manifest, plugin type or family of its own', () => {
    const { platform } = start(withAcp())

    const sessions = platform.runtime.service(ACP_SESSIONS)
    expect(sessions).toBeDefined()
    // The platform's own store under it, not the manager itself.
    expect(platform.runtime.service(THREAD_SESSIONS)).toBeDefined()
    expect(platform.runtime.service(THREAD_SESSIONS)).not.toBe(sessions)
    expect(platform.runtime.services('acp').has(THREAD_SESSIONS)).toBe(false)
    expect(platform.runtime.service(ACP_HARNESS)?.closed).toBe(false)
    expect(platform.runtime.service(ACP_DECISIONS)).toBeDefined()
    expect(platform.runtime.services('acp').has(ACP_SESSIONS)).toBe(true)
    expect(platform.capabilities.has('acp')).toBe(false)
    expect(platform.runtime.started.map(s => s.definition.id)).toEqual(['threads', 'repository', 'acp', 'claude-code', 'chat-claude-code', 'codex', 'chat-codex'])
    // The stand-in connections registered their families through the service, as claude-code and codex do.
    expect(platform.families.nameOf('claude-code')).toBe('Claude Code')
    expect(platform.families.nameOf('codex')).toBe('Codex')
  })

  it('mounts the session and decision routes under the workspace prefix', async () => {
    const { app } = start(withAcp())

    for (const path of ['sessions', 'sessions/s1/decisions']) {
      const res = await app.request(`${WORKSPACES_PATH}/nope/${path}`)
      expect(res.status, path).toBe(404)
      expect(((await res.json()) as ApiErrorBody).error.code, path).toBe('not_found')
    }
  })

  it('boots without it: those routes answer not found and threads are still served', async () => {
    const { platform, app } = start({ capabilities: [repositoryDefinition()] })

    expect(platform.runtime.service(ACP_SESSIONS)).toBeUndefined()
    expect(platform.runtime.service(THREAD_SESSIONS)).toBeDefined()
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
    expect(() => testKit({ capabilities: [acpDefinition()] })).toThrow(CapabilityDefinitionError)
    expect(() => testKit({ capabilities: [acpDefinition()] })).toThrow("Capability 'acp' depends on 'repository', which is not in the definition list.")
  })

  it('closes decisions, then sessions, then the harness, and the platform waits for it before shutting the database', async () => {
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

    const closing = platform.close()
    expect(() => platform.db.get(sql`select 1`)).not.toThrow()
    await closing
    expect(order).toEqual(['decisions', 'sessions', 'harness'])
    expect(acpHarness.closed).toBe(true)
    expect(sessions.signal.aborted).toBe(true)
    expect(() => platform.db.get(sql`select 1`)).toThrow(/not open/)
    vi.restoreAllMocks()
  })
})
