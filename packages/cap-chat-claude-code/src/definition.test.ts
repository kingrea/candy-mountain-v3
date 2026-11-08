import { WORKSPACES_PATH, type ApiErrorBody } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { ACP_SESSIONS, acpDefinition, fakeBins } from '@candy-mountain/cap-acp'
import { claudeCodeDefinition } from '@candy-mountain/plugin-claude-code'
import { repositoryDefinition } from '@candy-mountain/plugin-repository'
import { CapabilityDefinitionError, createTempDataDir, type Platform, platformApp, startTestPlatform, type TempDataDir, type TestPlatformOptions } from '@candy-mountain/platform-daemon'
import { chatClaudeCodeDefinition } from './definition'
import { acpTestProduct } from './test-support'

describe('the chat-claude-code definition', () => {
  let temp: TempDataDir
  const open: Platform[] = []

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    temp?.cleanup()
  })

  function start(options: TestPlatformOptions = {}) {
    temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, options)
    open.push(platform)
    return { platform, app: platformApp(platform) }
  }

  const withAcp = (): TestPlatformOptions => ({ product: acpTestProduct({ acp: { bins: fakeBins, killTimeoutMs: 1000 } }) })

  it('brings no plugin types or session families; it depends on claude-code for both, on acp and on repository', () => {
    const definition = chatClaudeCodeDefinition()

    expect(definition.pluginTypes ?? []).toEqual([])
    expect(definition.sessionFamilies ?? []).toEqual([])
    expect(definition.dependsOn).toEqual(['acp', 'claude-code', 'repository'])
  })

  it('shows Claude Code in the chat rail once claude-code has started, and offers no service of its own', () => {
    const { platform } = start(withAcp())

    expect(platform.runtime.started.map(s => s.definition.id)).toEqual(['threads', 'repository', 'acp', 'claude-code', 'chat-claude-code', 'codex', 'chat-codex'])
    expect(platform.capabilities.has('chat-claude-code')).toBe(true)
    expect(platform.runtime.services('chat-claude-code').has(ACP_SESSIONS)).toBe(false)
    expect(platform.pluginTypes.has('claude-code')).toBe(true)
    expect(platform.families.nameOf('claude-code')).toBe('Claude Code')
    // The stand-in connection registered its family through the service, as codex does.
    expect(platform.families.nameOf('codex')).toBe('Codex')
  })

  it('mounts the thread routes under the workspace prefix', async () => {
    const { app } = start(withAcp())

    const res = await app.request(`${WORKSPACES_PATH}/nope/threads`)
    expect(res.status).toBe(404)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('not_found')
  })

  it('boots without it: claude-code still brings its plugin type and family, and the session routes are still served', async () => {
    const { platform, app } = start({ capabilities: [repositoryDefinition(), acpDefinition(), claudeCodeDefinition()] })

    expect(platform.runtime.service(ACP_SESSIONS)).toBeDefined()
    expect(platform.capabilities.has('chat-claude-code')).toBe(false)
    expect(platform.pluginTypes.has('claude-code')).toBe(true)
    expect(platform.families.has('claude-code')).toBe(true)
    const sessions = await app.request(`${WORKSPACES_PATH}/nope/sessions`)
    expect(sessions.status).toBe(404)
    expect(((await sessions.json()) as ApiErrorBody).error.code).toBe('not_found')
  })

  it('refuses a list with chat-claude-code but without claude-code, naming it', () => {
    temp = createTempDataDir()
    const withoutClaudeCode = { capabilities: [repositoryDefinition(), acpDefinition(), chatClaudeCodeDefinition()], modules: [] }
    expect(() => startTestPlatform(temp.root, withoutClaudeCode)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp.root, withoutClaudeCode)).toThrow("Capability 'chat-claude-code' depends on 'claude-code', which is not in the definition list.")
  })
})
