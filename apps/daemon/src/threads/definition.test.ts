import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBins } from '../acp/test-support'
import { ACP_SESSIONS, chatClaudeCodeDefinition } from '../chat-claude-code/definition'
import type { Platform } from '../platform'
import { createProject } from '../projects/projects'
import { createTempDataDir, type TempDataDir } from '../testing'
import { CAPABILITY_DEFINITIONS, startTestPlatform, withoutCapabilities, type TestPlatformOptions } from '../testing/platform'
import { THREADS_CAPABILITY_ID } from './definition'
import { THREAD_SESSIONS } from './sessions'

describe('the threads definition', () => {
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

  function start(options: TestPlatformOptions = {}) {
    temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, options)
    open.push(platform)
    return platform
  }

  async function session(platform: Platform) {
    checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-threads-'))
    const project = await createProject(platform.db, { name: 'alpha', slug: 'alpha', source: { kind: 'local-path', path: checkout } })
    const store = platform.runtime.service(THREAD_SESSIONS)!
    return { store, row: store.create({ projectId: project.id, family: 'platform', actorId: 'actor', cwd: checkout }) }
  }

  it('is the platform\'s own, started first whatever the product lists, and is not a capability of the product', () => {
    const platform = start({ capabilities: [], modules: [] })

    expect(platform.runtime.started.map(s => s.definition.id)).toEqual([THREADS_CAPABILITY_ID])
    expect(platform.runtime.service(THREAD_SESSIONS)).toBeDefined()
    expect(platform.capabilities.has(THREADS_CAPABILITY_ID)).toBe(false)
    expect(platform.product.config.capabilities).not.toContain(THREADS_CAPABILITY_ID)
  })

  it('keeps rows and in-process turns without any harness, and refuses to prompt a family nothing launches', async () => {
    const platform = start(withoutCapabilities('chat-claude-code', 'bots', 'chat-codex'))
    const { store, row } = await session(platform)

    const seen: string[] = []
    store.subscribe(row.id, message => void seen.push(message.type === 'event' ? message.event.kind : `status:${message.status}`))
    await store.run(row.id, 'hello', async ({ emit }) => emit({ kind: 'text', role: 'agent', text: 'hi' }))
    await vi.waitFor(() => expect(store.get(row.id)?.status).toBe('idle'))
    expect(seen).toEqual(['prompt', 'status:prompting', 'text', 'turn_end', 'status:idle'])
    expect(store.configOptions(row.projectId, 'platform')).toEqual([])

    await expect(store.prompt(row.id, 'hello')).rejects.toMatchObject({ code: 'family_unavailable', message: 'No agent harness launches Platform agent sessions.' })
    expect(await store.cancel(row.id)).toMatchObject({ id: row.id, status: 'idle' })
    const driver = { assertPosture: () => {}, prompt: async () => row, cancel: async () => row, configOptions: () => [] }
    store.attach(driver)
    expect(() => store.attach(driver)).toThrow('The session store already has a driver.')
  })

  it('closes after the ACP manager that writes through it, and its signal ends with the platform', async () => {
    const platform = start({ capabilities: CAPABILITY_DEFINITIONS.map(c => (c.id === 'chat-claude-code' ? chatClaudeCodeDefinition({ acp: { bins: fakeBins, killTimeoutMs: 1000 } }) : c)) })
    const store = platform.runtime.service(THREAD_SESSIONS)!
    const sessions = platform.runtime.service(ACP_SESSIONS)!
    const order: string[] = []
    const record = <T extends object, K extends keyof T & string>(target: T, method: K, name: string) => {
      const original = (target[method] as unknown as (...args: unknown[]) => unknown).bind(target)
      vi.spyOn(target, method as never).mockImplementation(((...args: unknown[]) => {
        order.push(name)
        return original(...args)
      }) as never)
    }
    record(sessions, 'close', 'manager')
    record(store, 'close', 'store')

    expect(store.signal.aborted).toBe(false)
    await platform.close()
    expect(order).toEqual(['manager', 'store'])
    expect(store.signal.aborted).toBe(true)
    expect(sessions.signal.aborted).toBe(true)
  })
})
