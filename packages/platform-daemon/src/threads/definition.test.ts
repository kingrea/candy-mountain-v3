import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Platform } from '../platform'
import { createTempDataDir, startTestPlatform, type TempDataDir, type TestPlatformOptions } from '../testing'
import { createWorkspace } from '../workspaces/workspaces'
import { THREADS_CAPABILITY_ID } from './definition'
import { THREAD_SESSIONS } from './sessions'

describe('the threads definition', () => {
  let temp: TempDataDir
  const open: Platform[] = []

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    temp?.cleanup()
    vi.restoreAllMocks()
  })

  function start(options: TestPlatformOptions = {}) {
    temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, options)
    open.push(platform)
    return platform
  }

  function session(platform: Platform) {
    const workspace = createWorkspace(platform.db, { name: 'alpha', slug: 'alpha' })
    const store = platform.runtime.service(THREAD_SESSIONS)!
    return { store, row: store.create({ workspaceId: workspace.id, family: 'platform', actorId: 'actor', cwd: platform.paths.root }) }
  }

  it('is the platform\'s own, started first whatever the product lists, and is not a capability of the product', () => {
    const platform = start({ capabilities: [], modules: [] })

    expect(platform.runtime.started.map(s => s.definition.id)).toEqual([THREADS_CAPABILITY_ID])
    expect(platform.runtime.service(THREAD_SESSIONS)).toBeDefined()
    expect(platform.capabilities.has(THREADS_CAPABILITY_ID)).toBe(false)
    expect(platform.product.config.capabilities).not.toContain(THREADS_CAPABILITY_ID)
  })

  it('keeps rows and in-process turns without any harness, and refuses to prompt a family nothing launches', async () => {
    const platform = start({ capabilities: [], modules: [] })
    const { store, row } = session(platform)

    const seen: string[] = []
    store.subscribe(row.id, message => void seen.push(message.type === 'event' ? message.event.kind : `status:${message.status}`))
    await store.run(row.id, 'hello', async ({ emit }) => emit({ kind: 'text', role: 'agent', text: 'hi' }))
    await vi.waitFor(() => expect(store.get(row.id)?.status).toBe('idle'))
    expect(seen).toEqual(['prompt', 'status:prompting', 'text', 'turn_end', 'status:idle'])
    expect(store.configOptions(row.workspaceId, 'platform')).toEqual([])

    await expect(store.prompt(row.id, 'hello')).rejects.toMatchObject({ code: 'family_unavailable', message: 'No agent harness launches platform sessions.' })
    expect(await store.cancel(row.id)).toMatchObject({ id: row.id, status: 'idle' })
    const driver = { assertPosture: () => {}, prompt: async () => row, cancel: async () => row, configOptions: () => [], workingDirectory: () => null }
    store.attach(driver)
    expect(() => store.attach(driver)).toThrow('The session store already has a driver.')
  })
})
