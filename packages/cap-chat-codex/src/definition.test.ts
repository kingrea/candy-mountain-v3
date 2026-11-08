import { afterEach, describe, expect, it } from 'vitest'
import { CapabilityDefinitionError, createTempDataDir, type Platform, startTestPlatform, type TempDataDir } from '@candy-mountain/platform-daemon'
import { fakeBins } from '@candy-mountain/cap-acp'
import { codexTestCapabilities } from '@candy-mountain/plugin-codex'
import { chatCodexDefinition } from './definition'
import { startChatCodexPlatform } from './test-support'

const acp = { bins: fakeBins, killTimeoutMs: 1000 }

describe('the chat-codex definition', () => {
  let temp: TempDataDir
  const open: Platform[] = []

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    temp?.cleanup()
  })

  it('brings no plugin types or session families; it depends on codex for both and on acp', () => {
    const definition = chatCodexDefinition()

    expect(definition.pluginTypes ?? []).toEqual([])
    expect(definition.sessionFamilies ?? []).toEqual([])
    expect(definition.dependsOn).toEqual(['acp', 'codex'])
  })

  it('shows Codex in the chat rail once codex has started', () => {
    temp = createTempDataDir()
    const platform = startChatCodexPlatform(temp.root, { acp })
    open.push(platform)
    const started = platform.runtime.started.map(s => s.definition.id)

    expect(platform.capabilities.has('chat-codex')).toBe(true)
    expect(platform.pluginTypes.has('codex')).toBe(true)
    expect(platform.families.ids()).toEqual(['claude-code', 'codex'])
    expect(started.indexOf('chat-codex')).toBeGreaterThan(started.indexOf('codex'))
  })

  it('refuses a list with chat-codex but without codex, naming it', () => {
    temp = createTempDataDir()
    const withoutCodex = { capabilities: [...codexTestCapabilities(acp, { withCodex: false }), chatCodexDefinition()], modules: [] }
    expect(() => startTestPlatform(temp.root, withoutCodex)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp.root, withoutCodex)).toThrow("Capability 'chat-codex' depends on 'codex', which is not in the definition list.")
  })
})
