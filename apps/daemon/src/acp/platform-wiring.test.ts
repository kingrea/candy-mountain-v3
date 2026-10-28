import { afterEach, describe, expect, it } from 'vitest'
import { startPlatform, type Platform } from '../platform'
import { createTempDataDir, type TempDataDir } from '../testing'

describe('ACP harness on the platform', () => {
  let temp: TempDataDir | undefined
  let platform: Platform | undefined

  afterEach(() => {
    platform?.close()
    temp?.cleanup()
  })

  it('starts with the platform and is closed by it', async () => {
    temp = createTempDataDir()
    platform = startPlatform(temp.root)
    expect(platform.acpHarness.closed).toBe(false)
    expect(platform.acpHarness.list()).toEqual([])
    platform.close()
    expect(platform.acpHarness.closed).toBe(true)
    await expect(platform.acpHarness.startSession({ family: 'codex', cwd: temp.root, configHome: platform.paths.agentHomes })).rejects.toThrow(/closed/)
  })
})
