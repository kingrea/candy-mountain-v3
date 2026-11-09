import { afterEach, describe, expect, it } from 'vitest'
import { CapabilityDefinitionError } from '@crab-shack/platform-daemon'
import { testKit, type TestKit } from '@crab-shack/platform-daemon/testing'
import { fakeBins } from '@candy-mountain/testing'
import { chatCodexDefinition } from './definition'
import { chatCodexKit, codexTestCapabilities } from './test-support'

const acp = { bins: fakeBins, killTimeoutMs: 1000 }

describe('the chat-codex definition', () => {
  let kit: TestKit | undefined

  afterEach(async () => {
    await kit?.close()
    kit = undefined
  })

  it('brings no plugin types or session families; it depends on codex for both and on acp', () => {
    const definition = chatCodexDefinition()

    expect(definition.pluginTypes ?? []).toEqual([])
    expect(definition.sessionFamilies ?? []).toEqual([])
    expect(definition.dependsOn).toEqual(['acp', 'codex'])
  })

  it('shows Codex in the chat rail once codex has started', () => {
    kit = chatCodexKit({ acp })
    const { platform } = kit
    const started = platform.runtime.started.map(s => s.definition.id)

    expect(platform.capabilities.has('chat-codex')).toBe(true)
    expect(platform.pluginTypes.has('codex')).toBe(true)
    expect(platform.families.ids()).toEqual(['claude-code', 'codex'])
    expect(started.indexOf('chat-codex')).toBeGreaterThan(started.indexOf('codex'))
  })

  it('refuses a list with chat-codex but without codex, naming it', () => {
    const withoutCodex = { capabilities: [...codexTestCapabilities(acp, { withCodex: false }), chatCodexDefinition()], modules: [] }
    expect(() => testKit(withoutCodex)).toThrow(CapabilityDefinitionError)
    expect(() => testKit(withoutCodex)).toThrow("Capability 'chat-codex' depends on 'codex', which is not in the definition list.")
  })
})
