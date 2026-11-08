import { afterEach, describe, expect, it } from 'vitest'
import { acpKit, type AcpKit } from '../test-support'

describe('ACP harness on the platform', () => {
  let kit: AcpKit | undefined

  afterEach(async () => {
    await kit?.close()
    kit = undefined
  })

  it('starts with the platform and is closed by it', async () => {
    kit = acpKit()
    expect(kit.acpHarness.closed).toBe(false)
    expect(kit.acpHarness.list()).toEqual([])
    await kit.platform.close()
    expect(kit.acpHarness.closed).toBe(true)
    await expect(kit.acpHarness.startSession({ family: 'codex', cwd: kit.platform.paths.root, configHome: kit.platform.paths.agentHomes })).rejects.toThrow(/closed/)
  })
})
