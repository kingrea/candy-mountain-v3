import { afterEach, describe, expect, it } from 'vitest'
import { startAcpPlatform, type AcpPlatform } from '../chat-claude-code/test-support'
import { createTempDataDir, type TempDataDir } from '../testing'

describe('ACP harness on the platform', () => {
  let temp: TempDataDir | undefined
  let platform: AcpPlatform | undefined

  afterEach(() => {
    platform?.close()
    temp?.cleanup()
  })

  it('starts with the platform and is closed by it', async () => {
    temp = createTempDataDir()
    platform = startAcpPlatform(temp.root)
    expect(platform.acpHarness.closed).toBe(false)
    expect(platform.acpHarness.list()).toEqual([])
    await platform.close()
    expect(platform.acpHarness.closed).toBe(true)
    await expect(platform.acpHarness.startSession({ family: 'codex', cwd: temp.root, configHome: platform.paths.agentHomes })).rejects.toThrow(/closed/)
  })
})
