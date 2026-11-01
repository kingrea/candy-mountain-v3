import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ActivityListResponse, ApiErrorBody, ModuleDefinition } from '@candy-mountain/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { ACTIVITY_EVENT_TYPES, ActivityEventTypeError, appendActivityEvent } from './activity'
import { CapabilityManifestError } from './capabilities'
import { cloneManifest, fixtureCapability } from './capabilities/fixtures'
import { ModuleDefinitionError } from './modules'
import { createTestApp, startTestPlatform, type TestPlatformOptions } from './testing/platform'
import { PluginTypeError } from './plugins'
import { fixturePluginType } from './plugins/fixtures'
import { createProject } from './projects/projects'
import { SESSION_FAMILIES, SessionFamilyError } from './threads'
import { createTempDataDir, type TempDataDir } from './testing'

const operations = (capabilityId: string): ModuleDefinition => ({
  id: 'operations',
  label: 'Operations',
  description: 'Ops.',
  icon: 'i-lucide-activity',
  capabilities: [{ capabilityId, defaultRung: 'read' }],
})

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
    ['activity event type', { activityEventTypes: [...ACTIVITY_EVENT_TYPES, 'run.started'] }, ActivityEventTypeError, "Duplicate activity event type(s): 'run.started'."],
  ])('refuses a duplicate %s id', (_what, options, error, message) => refuses(options, error, message))

  it.each<[string, TestPlatformOptions, new (...args: never[]) => Error, string]>([
    ['module', { capabilities: [fixtureCapability('uptime')], modules: [{ ...operations('uptime'), id: 'Ops' }] }, ModuleDefinitionError, "Invalid module id 'Ops'"],
    ['plugin type', { pluginTypes: [{ ...fixturePluginType('netlify'), id: 'Net lify' }] }, PluginTypeError, "Invalid plugin type id 'Net lify'"],
    ['session family', { families: [{ id: 'Claude Code', name: 'Claude Code' }] }, SessionFamilyError, "Invalid session family id 'Claude Code'"],
    ['activity event type', { activityEventTypes: ['Run Started'] }, ActivityEventTypeError, "Invalid activity event type(s) 'Run Started'"],
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

  it('refuses an agent that names an unregistered session family', () => {
    refuses(
      { capabilities: [codexChat()], modules: [], families: SESSION_FAMILIES },
      SessionFamilyError,
      "Capability 'chat-codex': agent 'chat-codex-agent' runs unregistered session family 'codex'.",
    )
  })

  it('starts with a family and an event type no shared list knows, and refuses events of an unregistered type', async () => {
    temp = createTempDataDir()
    const checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-open-ids-'))
    const cap = cloneManifest(fixtureCapability('chat-codex'))
    cap.agents[0]!.family = 'helper'
    const platform = startTestPlatform(temp.root, {
      capabilities: [cap],
      modules: [],
      families: [...SESSION_FAMILIES, { id: 'helper', name: 'Helper' }],
      activityEventTypes: [...ACTIVITY_EVENT_TYPES, 'widget.built'],
    })
    try {
      expect(platform.families.nameOf('helper')).toBe('Helper')
      expect(platform.families.nameOf('gone')).toBe('gone')
      const project = await createProject(platform.db, { name: 'alpha', source: { kind: 'local-path', path: checkout } })
      appendActivityEvent(platform.db, { projectId: project.id, type: 'widget.built', title: 'Widget built' })
      expect(() => appendActivityEvent(platform.db, { projectId: project.id, type: 'widget.broken', title: 'x' })).toThrow("Activity event type 'widget.broken' is not registered.")

      const app = createTestApp({ db: platform.db, paths: platform.paths, capabilities: platform.capabilities, modules: platform.modules, families: platform.families })
      const listed = await app.request('/projects/alpha/activity?type=widget.built')
      expect((await listed.json() as ActivityListResponse).events.map(e => e.type)).toEqual(['widget.built'])
      const refused = await app.request('/projects/alpha/activity?type=widget.broken')
      expect(refused.status).toBe(400)
      expect((await refused.json() as ApiErrorBody).error.message).toBe('Unknown activity type: widget.broken')
    }
    finally {
      platform.close()
      rmSync(checkout, { recursive: true, force: true })
    }
  })
})
