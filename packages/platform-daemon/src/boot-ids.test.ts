import { existsSync } from 'node:fs'
import type { ActivityListResponse, ApiErrorBody, ModuleDefinition } from '@candy-mountain/platform-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityEventTypeError, appendActivityEvent, type ActivityEventTypeDeclaration } from './activity'
import { CapabilityManifestError } from './capabilities'
import { CapabilityDefinitionError, defineCapabilityDefinition, type CapabilityDefinition } from './capabilities/definition'
import { cloneManifest, fixtureCapability } from './capabilities/fixtures'
import { ModuleDefinitionError } from './modules'
import { createTempDataDir, createTestApp, startTestPlatform, type TempDataDir, type TestPlatformOptions } from './testing'
import { PluginTypeError } from './plugins/definition'
import { WorkspaceFactError, type WorkspaceFactDeclaration } from './registry/facts'
import { fixturePluginType } from './plugins/fixtures'
import { SESSION_FAMILIES, SessionFamilyError } from './threads'
import { createWorkspace } from './workspaces/workspaces'

const operations = (capabilityId: string): ModuleDefinition => ({
  id: 'operations',
  label: 'Operations',
  description: 'Ops.',
  icon: 'i-lucide-activity',
  capabilities: [{ capabilityId, defaultRung: 'read' }],
})

const widgets = (...activityEventTypes: ActivityEventTypeDeclaration[]) => defineCapabilityDefinition({ id: 'widgets', activityEventTypes })
const gadgets = defineCapabilityDefinition({ id: 'gadgets', activityEventTypes: [{ id: 'gadget.built', label: 'Gadget built', notifications: [{ id: 'gadget.done', label: 'A gadget is done' }] }], workspaceFacts: [{ id: 'hasGadgets', compute: () => true, message: () => 'No gadgets.' }] })
// Not through the helper, so a malformed fact reaches the boot-time validation under test.
const knowing = (...workspaceFacts: WorkspaceFactDeclaration[]): CapabilityDefinition => ({ id: 'widgets', workspaceFacts })
const fact = (id: string): WorkspaceFactDeclaration => ({ id, compute: () => true, message: () => `No ${id}.` })

function codexChat() {
  const cap = cloneManifest(fixtureCapability('chat-codex'))
  cap.agents[0]!.family = 'codex'
  return cap
}

describe('daemon boot with open ids', () => {
  let temp: TempDataDir
  afterEach(() => temp?.cleanup())

  const refuses = (options: TestPlatformOptions, error: new (...args: never[]) => Error, message: string) => {
    temp = createTempDataDir()
    expect(() => startTestPlatform(temp.root, options)).toThrow(error)
    expect(() => startTestPlatform(temp.root, options)).toThrow(message)
    expect(existsSync(temp.root)).toBe(false)
  }

  it.each<[string, TestPlatformOptions, new (...args: never[]) => Error, string]>([
    ['capability', { capabilities: [fixtureCapability('uptime'), fixtureCapability('uptime')], modules: [] }, CapabilityManifestError, "Duplicate capability id(s) across capabilities: 'uptime' (uptime)."],
    ['module', { capabilities: [fixtureCapability('uptime')], modules: [operations('uptime'), operations('uptime')] }, ModuleDefinitionError, "Duplicate module id(s): 'operations'."],
    ['plugin type', { pluginTypes: [fixturePluginType('netlify'), fixturePluginType('netlify')] }, PluginTypeError, "Duplicate plugin type id(s): 'netlify'."],
    ['session family', { families: [...SESSION_FAMILIES, { id: 'helper', name: 'Helper' }, { id: 'helper', name: 'Helper again' }] }, SessionFamilyError, "Duplicate session family id(s): 'helper'."],
    ['activity event type', { capabilities: [widgets({ id: 'run.started', label: 'Run started again' })] }, ActivityEventTypeError, "Duplicate activity event type(s): 'run.started'."],
    ['notification kind', { capabilities: [gadgets, widgets({ id: 'widget.built', label: 'Widget built', notifications: [{ id: 'gadget.done', label: 'A widget is built' }] })] }, ActivityEventTypeError, "Duplicate notification kind(s): 'gadget.done'."],
    ['workspace fact', { capabilities: [gadgets, knowing(fact('hasGadgets'))] }, WorkspaceFactError, "Duplicate workspace fact id(s): 'hasGadgets'."],
  ])('refuses a duplicate %s id', (_what, options, error, message) => refuses(options, error, message))

  it.each<[string, TestPlatformOptions, new (...args: never[]) => Error, string]>([
    ['module', { capabilities: [fixtureCapability('uptime')], modules: [{ ...operations('uptime'), id: 'Ops' }] }, ModuleDefinitionError, "Invalid module id 'Ops'"],
    ['plugin type', { pluginTypes: [{ ...fixturePluginType('netlify'), id: 'Net lify' }] }, PluginTypeError, "Invalid plugin type id 'Net lify'"],
    ['session family', { families: [{ id: 'Claude Code', name: 'Claude Code' }] }, SessionFamilyError, "Invalid session family id 'Claude Code'"],
    ['activity event type', { capabilities: [widgets({ id: 'Run Started', label: 'Run started' })] }, ActivityEventTypeError, "Invalid activity event type(s) 'Run Started'"],
    ['notification kind', { capabilities: [widgets({ id: 'widget.built', label: 'Widget built', notifications: [{ id: 'Widget Built', label: 'A widget is built' }] })] }, ActivityEventTypeError, "Invalid notification kind(s) 'Widget Built'"],
    ['workspace fact', { capabilities: [knowing({ ...fact('hasWidgets'), id: 'has-widgets' })] }, CapabilityDefinitionError, "Capability 'widgets': declares invalid workspace fact(s) 'has-widgets'"],
  ])('refuses a malformed %s id', (_what, options, error, message) => refuses(options, error, message))

  it('refuses a module that names an unregistered capability', () => {
    refuses({ capabilities: [fixtureCapability('uptime')], modules: [operations('deployments')] }, ModuleDefinitionError, "Module 'operations': capability 'deployments' is not registered.")
  })

  it('refuses a manifest that requires an unregistered plugin type', () => {
    refuses(
      { pluginTypes: [fixturePluginType('repository')], capabilities: [fixtureCapability('deployments', ['repository', 'netlify'])], modules: [] },
      CapabilityManifestError,
      "Capability 'deployments' requires unknown plugin type 'netlify'.",
    )
  })

  it('refuses a manifest that requires a workspace fact no definition declares, naming both', () => {
    const team = cloneManifest(fixtureCapability('team'))
    team.requiresWorkspaceFacts = ['hasWidgets']
    refuses({ capabilities: [gadgets, team], modules: [] }, WorkspaceFactError, "Capability 'team' requires workspace fact 'hasWidgets', which no definition declares.")
    temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, { capabilities: [gadgets, team, knowing(fact('hasWidgets'))], modules: [] })
    try {
      expect(platform.workspaceFacts.list()).toEqual(['hasGadgets', 'hasWidgets'])
    }
    finally {
      platform.close()
    }
  })

  it('refuses an agent that names an unregistered session family', () => {
    refuses(
      { capabilities: [codexChat()], modules: [], families: SESSION_FAMILIES },
      SessionFamilyError,
      "Capability 'chat-codex': agent 'chat-codex-agent' runs unregistered session family 'codex'.",
    )
  })

  it('starts with a family and an event type no shared list knows, and refuses events of an unregistered type', async () => {
    temp = createTempDataDir()
    const cap = cloneManifest(fixtureCapability('chat-codex'))
    cap.agents[0]!.family = 'helper'
    const platform = startTestPlatform(temp.root, {
      capabilities: [cap, widgets({ id: 'widget.built', label: 'Widget built' })],
      modules: [],
      families: [...SESSION_FAMILIES, { id: 'helper', name: 'Helper' }],
    })
    try {
      expect(platform.families.nameOf('helper')).toBe('Helper')
      expect(platform.families.nameOf('gone')).toBe('gone')
      // No repository capability is booted, so the workspace has no repository record.
      const workspace = createWorkspace(platform.db, { name: 'alpha' })
      appendActivityEvent(platform.db, { workspaceId: workspace.id, type: 'widget.built', title: 'Widget built' })
      expect(() => appendActivityEvent(platform.db, { workspaceId: workspace.id, type: 'widget.broken', title: 'x' })).toThrow("Activity event type 'widget.broken' is not registered.")

      const app = createTestApp({ db: platform.db, paths: platform.paths, capabilities: platform.capabilities, modules: platform.modules, families: platform.families })
      const listed = await app.request('/workspaces/alpha/activity?type=widget.built')
      expect((await listed.json() as ActivityListResponse).events.map(e => e.type)).toEqual(['widget.built'])
      const refused = await app.request('/workspaces/alpha/activity?type=widget.broken')
      expect(refused.status).toBe(400)
      expect((await refused.json() as ApiErrorBody).error.message).toBe('Unknown activity type: widget.broken')
    }
    finally {
      platform.close()
    }
  })
})
