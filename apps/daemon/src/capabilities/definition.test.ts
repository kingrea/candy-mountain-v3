import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MONITOR_SOURCES_PATH, PROJECTS_PATH, type Actor, type ApiErrorBody, type MonitorSourceListResponse } from '@candy-mountain/shared'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentMcpServerDefinition } from '../agent-mcp/host'
import type { AppEnv } from '../app'
import { ensureDataDir } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { fixturePluginType } from '../plugins/fixtures'
import { openTestDatabase } from '../testing'
import { monitorRoutes, monitorSourceRoutes, startIncidentTracker, startUptimeScheduler, type IncidentTracker, type UptimeScheduler } from '../uptime'
import {
  assertCapabilityDefinition,
  bindService,
  boundServices,
  CapabilityDefinitionError,
  defineCapabilityDefinition,
  dependencyServices,
  isCapabilityDefinition,
  serviceKey,
  type BoundServices,
  type CapabilityDefinition,
  type CapabilityRuntime,
  type NotificationChannel,
} from './definition'
import { cloneManifest, fixtureCapability, fixtureCapabilityContext, fixtureDefinition } from './fixtures'
import { CapabilityManifestError } from './manifest'
import { assertCapabilityDefinitions, createCapabilityRegistry, orderCapabilityDefinitions } from './registry'

const rejects = (fn: () => unknown, message: string | RegExp, type: new (...args: never[]) => Error = CapabilityDefinitionError) => {
  expect(fn).toThrow(type)
  expect(fn).toThrow(message)
}

describe('defineCapabilityDefinition', () => {
  it('returns the definition unchanged', () => {
    const manifest = fixtureCapability('uptime')
    const start = () => ({})
    const definition = defineCapabilityDefinition({ id: 'uptime', manifest, start })
    expect(definition).toEqual({ id: 'uptime', manifest, start })
    expect(isCapabilityDefinition(definition)).toBe(true)
    expect(isCapabilityDefinition(manifest)).toBe(false)
  })

  it('accepts a service-only definition with no manifest', () => {
    const definition = defineCapabilityDefinition({ id: 'slack', pluginTypes: [fixturePluginType('slack')], provides: [serviceKey('slack.connections')], start: () => ({}) })
    expect(definition.manifest).toBeUndefined()
  })

  it('accepts a dependency-only definition with nothing to start', () => {
    expect(() => defineCapabilityDefinition({ id: 'chat-codex', manifest: fixtureCapability('chat-codex'), dependsOn: ['chat-claude-code'] })).not.toThrow()
  })

  it('rejects a bad id before anything else', () => {
    rejects(() => assertCapabilityDefinition({ id: 'Has Spaces' }), "Invalid capability id 'Has Spaces'")
    rejects(() => assertCapabilityDefinition({ id: undefined as never }), "Invalid capability id 'undefined'")
  })

  it('rejects a manifest whose id differs', () => {
    rejects(() => fixtureDefinition('uptime', { manifest: fixtureCapability('team') }), "Capability 'uptime': manifest id 'team' does not match.")
  })

  it('rejects a bad manifest with the manifest error naming the capability', () => {
    const broken = cloneManifest(fixtureCapability('uptime'))
    broken.ladder.shift()
    rejects(() => fixtureDefinition('uptime', { manifest: broken }), "Capability 'uptime': the ladder must start with a rung named 'none'.", CapabilityManifestError)
  })

  it('rejects bad dependency declarations', () => {
    rejects(() => fixtureDefinition('bots', { dependsOn: ['bots'] }), "Capability 'bots': depends on itself.")
    rejects(() => fixtureDefinition('bots', { dependsOn: ['slack', 'slack'] }), "Capability 'bots': repeats dependency 'slack'.")
    rejects(() => fixtureDefinition('bots', { dependsOn: ['Slack!'] }), "Capability 'bots': invalid dependency id(s) 'Slack!'.")
  })

  it('rejects a bad or repeated plugin type naming the capability', () => {
    const broken = { ...fixturePluginType('slack'), reach: [] }
    rejects(() => fixtureDefinition('slack', { manifest: null, pluginTypes: [broken] }), "Capability 'slack': Plugin type 'slack': needs at least one reach line, none empty.")
    rejects(() => fixtureDefinition('slack', { manifest: null, pluginTypes: [fixturePluginType('slack'), fixturePluginType('slack')] }), "Capability 'slack': brings plugin type 'slack' more than once.")
  })

  it('rejects a bad or repeated session family naming the capability', () => {
    rejects(() => fixtureDefinition('chat-codex', { sessionFamilies: [{ id: 'Codex', name: 'Codex' }] }), "Capability 'chat-codex': registers invalid session family(ies) 'Codex'")
    rejects(() => fixtureDefinition('chat-codex', { sessionFamilies: [{ id: 'codex', name: ' ' }] }), "Capability 'chat-codex': registers invalid session family(ies) 'codex'")
    const codex = { id: 'codex', name: 'Codex' }
    rejects(() => fixtureDefinition('chat-codex', { sessionFamilies: [codex, codex] }), "Capability 'chat-codex': registers session family 'codex' more than once.")
  })

  it('rejects bad service keys', () => {
    rejects(() => serviceKey('Bad Key'), "Invalid service key 'Bad Key'")
    rejects(() => fixtureDefinition('slack', { provides: [{ name: 'Bad Key' }] }), "Capability 'slack': provides invalid service key(s) 'Bad Key'.")
    const key = serviceKey('slack.connections')
    rejects(() => fixtureDefinition('slack', { provides: [key, key] }), "Capability 'slack': provides service 'slack.connections' more than once.")
  })

  it('rejects a start that is not a function', () => {
    rejects(() => fixtureDefinition('uptime', { start: {} as never }), "Capability 'uptime': start must be a function.")
  })
})

describe('assertCapabilityDefinitions', () => {
  it('accepts a list whose dependencies and plugin types resolve', () => {
    const slack = fixtureDefinition('slack', { manifest: null, pluginTypes: [fixturePluginType('slack')] })
    const bots = fixtureDefinition('bots', { manifest: fixtureCapability('bots', ['slack', 'repository']), dependsOn: ['slack'] })
    expect(() => assertCapabilityDefinitions([bots, slack], { pluginTypeIds: ['repository'] })).not.toThrow()
  })

  it('refuses a duplicate id', () => {
    rejects(() => assertCapabilityDefinitions([fixtureDefinition('uptime'), fixtureDefinition('uptime')]), "Capability 'uptime' is defined more than once")
  })

  it('refuses a dependency that is not in the list, naming both sides', () => {
    rejects(() => assertCapabilityDefinitions([fixtureDefinition('bots', { dependsOn: ['slack'] })]), "Capability 'bots' depends on 'slack', which is not in the definition list.")
  })

  it('refuses a dependency cycle, naming every capability on it', () => {
    const a = fixtureDefinition('bots', { dependsOn: ['chat-claude-code'] })
    const b = fixtureDefinition('chat-claude-code', { dependsOn: ['team'] })
    const c = fixtureDefinition('team', { dependsOn: ['bots'] })
    rejects(() => assertCapabilityDefinitions([fixtureDefinition('uptime'), a, b, c]), "Capability dependencies form a cycle: 'bots' -> 'chat-claude-code' -> 'team' -> 'bots'.")
  })

  it('refuses a required plugin type that neither the list nor the product supplies, naming both', () => {
    const bots = fixtureDefinition('bots', { manifest: fixtureCapability('bots', ['repository']) })
    rejects(() => assertCapabilityDefinitions([bots]), "Capability 'bots' requires plugin type 'repository', which neither the definition list nor the product supplies.")
    rejects(() => assertCapabilityDefinitions([bots], { pluginTypeIds: ['slack'] }), "Capability 'bots' requires plugin type 'repository'")
    expect(() => assertCapabilityDefinitions([bots], { pluginTypeIds: ['repository'] })).not.toThrow()
    const anyOf = fixtureDefinition('bots', { manifest: { ...fixtureCapability('bots'), requiresAnyPlugins: [['claude-code', 'codex']] } })
    rejects(() => assertCapabilityDefinitions([anyOf], { pluginTypeIds: ['claude-code'] }), "Capability 'bots' requires plugin type 'codex'")
  })

  it('refuses a plugin type brought twice or already supplied by the product, naming both sides', () => {
    const slack = fixtureDefinition('slack', { manifest: null, pluginTypes: [fixturePluginType('slack')] })
    const bots = fixtureDefinition('bots', { pluginTypes: [fixturePluginType('slack')] })
    rejects(() => assertCapabilityDefinitions([slack, bots]), "Plugin type 'slack' is brought by both capability 'slack' and capability 'bots'.")
    rejects(() => assertCapabilityDefinitions([slack], { pluginTypeIds: ['slack'] }), "Plugin type 'slack' is brought by capability 'slack' but the product already supplies it.")
  })

  it('refuses a session family registered twice or already supplied by the product, naming both sides', () => {
    const codex = { id: 'codex', name: 'Codex' }
    const chat = fixtureDefinition('chat-codex', { sessionFamilies: [codex] })
    const bots = fixtureDefinition('bots', { sessionFamilies: [codex] })
    rejects(() => assertCapabilityDefinitions([chat, bots]), "Session family 'codex' is registered by both capability 'chat-codex' and capability 'bots'.")
    rejects(() => assertCapabilityDefinitions([chat], { familyIds: ['codex'] }), "Session family 'codex' is registered by capability 'chat-codex' but the product already supplies it.")
    expect(() => assertCapabilityDefinitions([chat], { familyIds: ['platform'] })).not.toThrow()
  })

  it('refuses a service key provided by two definitions, naming both sides', () => {
    const key = serviceKey('acp.sessions')
    rejects(
      () => assertCapabilityDefinitions([fixtureDefinition('chat-claude-code', { provides: [key] }), fixtureDefinition('chat-codex', { provides: [serviceKey('acp.sessions')] })]),
      "Service 'acp.sessions' is provided by both capability 'chat-claude-code' and capability 'chat-codex'.",
    )
  })
})

describe('orderCapabilityDefinitions', () => {
  it('puts dependencies before dependents and keeps list order otherwise', () => {
    const list = [
      fixtureDefinition('bots', { dependsOn: ['chat-claude-code', 'slack'] }),
      fixtureDefinition('uptime'),
      fixtureDefinition('chat-claude-code', { dependsOn: ['slack'] }),
      fixtureDefinition('slack', { manifest: null }),
    ]
    expect(orderCapabilityDefinitions(list).map(d => d.id)).toEqual(['slack', 'chat-claude-code', 'bots', 'uptime'])
    expect(orderCapabilityDefinitions([list[1]!, list[3]!, list[2]!, list[0]!]).map(d => d.id)).toEqual(['uptime', 'slack', 'chat-claude-code', 'bots'])
  })
})

describe('createCapabilityRegistry with definitions', () => {
  it('answers manifest questions from definitions and lists service-only ones only as definitions', () => {
    const slack = fixtureDefinition('slack', { manifest: null, pluginTypes: [fixturePluginType('slack')] })
    const uptime = fixtureDefinition('uptime')
    const team = fixtureCapability('team')
    const registry = createCapabilityRegistry([team, slack, uptime])

    expect(registry.list().map(c => c.id)).toEqual(['team', 'uptime'])
    expect(registry.get('uptime')).toBe(uptime.manifest)
    expect(registry.has('slack')).toBe(false)
    expect(registry.definitions()).toEqual([slack, uptime])
  })

  it('lets a definition bring the plugin type a bare manifest requires', () => {
    const slack = fixtureDefinition('slack', { manifest: null, pluginTypes: [fixturePluginType('slack')] })
    const team = fixtureCapability('team', ['slack'])
    expect(() => createCapabilityRegistry([team, slack], { pluginTypeIds: ['repository'] })).not.toThrow()
    rejects(() => createCapabilityRegistry([team], { pluginTypeIds: ['repository'] }), "Capability 'team' requires unknown plugin type 'slack'.", CapabilityManifestError)
  })

  it('refuses the same id as a manifest and as a definition', () => {
    rejects(() => createCapabilityRegistry([fixtureCapability('uptime'), fixtureDefinition('uptime')]), "Duplicate capability id(s) across capabilities: 'uptime' (uptime).", CapabilityManifestError)
    rejects(() => createCapabilityRegistry([fixtureCapability('uptime'), fixtureDefinition('uptime', { manifest: null })]), "Capability 'uptime' is both a service-only definition and a manifest.")
  })

  it('still applies the cross-manifest checks to manifests inside definitions', () => {
    const issues = cloneManifest(fixtureCapability('issues'))
    issues.views[0]!.path = 'overview'
    rejects(() => createCapabilityRegistry([fixtureDefinition('overview'), fixtureDefinition('issues', { manifest: issues })]), "Duplicate view path(s) across capabilities: 'overview' (overview, issues).", CapabilityManifestError)
  })
})

describe('services', () => {
  const CONNECTIONS = serviceKey<{ web(): string }>('slack.connections')
  const OTHER = serviceKey<number>('slack.other')
  const slack = fixtureDefinition('slack', { manifest: null, provides: [CONNECTIONS] })

  it('exposes exactly the services a definition provides', () => {
    const services = boundServices(slack, { services: [bindService(CONNECTIONS, { web: () => 'ok' })] })
    expect(services.has(CONNECTIONS)).toBe(true)
    expect(services.get(CONNECTIONS).web()).toBe('ok')
    rejects(() => services.get(OTHER), "Capability 'slack' does not bind service 'slack.other'.")
  })

  it('refuses bindings that do not match the declaration, naming the capability and the key', () => {
    rejects(() => boundServices(slack, {}), "Capability 'slack' provides service 'slack.connections' but did not bind it.")
    rejects(() => boundServices(slack, { services: [bindService(CONNECTIONS, { web: () => '' }), bindService(OTHER, 1)] }), "Capability 'slack' binds service 'slack.other' without providing it.")
    rejects(() => boundServices(slack, { services: [bindService(CONNECTIONS, { web: () => '' }), bindService(CONNECTIONS, { web: () => '' })] }), "Capability 'slack' binds service 'slack.connections' twice.")
    rejects(() => boundServices(fixtureDefinition('uptime'), {}).get(OTHER), "Service 'slack.other' is not bound.")
  })

  it('resolves a dependency service only through the dependency declaration', () => {
    const bound = new Map<string, BoundServices>([['slack', boundServices(slack, { services: [bindService(CONNECTIONS, { web: () => 'ok' })] })]])
    const bots = fixtureDefinition('bots', { dependsOn: ['slack'] })
    expect(dependencyServices(bots, bound).get(CONNECTIONS).web()).toBe('ok')
    expect(dependencyServices(bots, bound).has(OTHER)).toBe(false)

    const team = fixtureDefinition('team', { dependsOn: ['bots'] })
    rejects(() => dependencyServices(team, bound).get(CONNECTIONS), "Capability 'team' asked for service 'slack.connections', which no declared dependency provides.")
    rejects(() => dependencyServices(fixtureDefinition('uptime'), bound).get(CONNECTIONS), "Capability 'uptime' asked for service 'slack.connections'")
  })
})

describe('a definition for an existing capability', () => {
  let database: PlatformDatabase
  let root: string
  const open: CapabilityRuntime[] = []

  afterEach(async () => {
    for (const runtime of open.splice(0).reverse()) await runtime.close?.()
    database?.close()
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('expresses uptime with the helper alone: routes, services and close', async () => {
    database = openTestDatabase()
    root = mkdtempSync(join(tmpdir(), 'candy-mountain-definition-'))
    const paths = ensureDataDir(join(root, 'data'))

    const uptime = defineCapabilityDefinition({
      id: 'uptime',
      manifest: fixtureCapability('uptime'),
      start({ db, paths, scopeUrlPrefix }) {
        const scheduler: UptimeScheduler = startUptimeScheduler({ db, key: paths.root, ownerFile: join(paths.run, 'uptime-scheduler.owner') })
        const incidents: IncidentTracker = startIncidentTracker({ db, scheduler, scopeUrlPrefix })
        return {
          workspaceRoutes: [monitorRoutes()],
          platformRoutes: [{ path: MONITOR_SOURCES_PATH, routes: monitorSourceRoutes() }],
          close() {
            incidents.close()
            scheduler.close()
          },
        }
      },
    })

    const context = fixtureCapabilityContext(database.db, { paths })
    const runtime = uptime.start!(context)
    open.push(runtime)

    const app = new Hono<AppEnv>()
    app.use(async (c, next) => {
      c.set('db', context.db)
      c.set('paths', context.paths)
      c.set('capabilities', context.capabilities)
      c.set('modules', context.modules)
      c.set('pluginTypes', context.pluginTypes)
      c.set('secrets', context.secrets.writeOnly)
      c.set('scopeLabel', context.scopeLabel)
      c.set('authStrategy', 'development')
      c.set('actor', { id: 'u1', username: 'jack', displayName: 'Jack', roles: ['admin'] } satisfies Actor)
      await next()
    })
    for (const routes of runtime.workspaceRoutes ?? []) app.route(PROJECTS_PATH, routes)
    for (const { path, routes } of runtime.platformRoutes ?? []) app.route(path, routes)

    const sources = await app.request(MONITOR_SOURCES_PATH)
    expect(sources.status).toBe(200)
    expect(((await sources.json()) as MonitorSourceListResponse).sources.length).toBeGreaterThan(0)
    const monitors = await app.request(`${PROJECTS_PATH}/nope/monitors`)
    expect(monitors.status).toBe(404)
    expect(((await monitors.json()) as ApiErrorBody).error.code).toBe('not_found')
  })

  it('expresses a service-only capability that offers a service, MCP servers, a notification channel and a deletion hook', async () => {
    database = openTestDatabase()
    const CONNECTIONS = serviceKey<{ web(botId: string): string | null }>('slack.connections')
    const deliver = vi.fn(async () => true)
    const deleted: string[] = []
    const closed: string[] = []
    const slack = defineCapabilityDefinition({
      id: 'slack',
      pluginTypes: [fixturePluginType('slack')],
      provides: [CONNECTIONS],
      start({ db }) {
        const connections = { web: (botId: string) => (db ? `web:${botId}` : null) }
        const server: AgentMcpServerDefinition = { name: 'slack', appliesTo: session => session.posture?.bot?.holder.kind === 'slack', tools: [] }
        const channel: NotificationChannel = { id: 'slack', deliver }
        return {
          services: [bindService(CONNECTIONS, connections)],
          mcpServers: [server],
          notificationChannels: [channel],
          onWorkspaceDeleted: workspace => void deleted.push(workspace.id),
          close: () => void closed.push('slack'),
        }
      },
    })
    const bots: CapabilityDefinition = defineCapabilityDefinition({
      id: 'bots',
      manifest: fixtureCapability('bots'),
      dependsOn: ['slack'],
      start: ({ service }) => ({ chatFamilies: { platform: async () => void service(CONNECTIONS).web('b1') }, close: () => void closed.push('bots') }),
    })

    const registry = createCapabilityRegistry([slack, bots])
    const ordered = orderCapabilityDefinitions(registry.definitions())
    expect(ordered.map(d => d.id)).toEqual(['slack', 'bots'])

    const bound = new Map<string, BoundServices>()
    const runtimes: CapabilityRuntime[] = []
    for (const definition of ordered) {
      const runtime = definition.start!(fixtureCapabilityContext(database.db, { capabilities: registry, service: dependencyServices(definition, bound).get }))
      bound.set(definition.id, boundServices(definition, runtime))
      runtimes.push(runtime)
    }

    expect(bound.get('slack')!.get(CONNECTIONS).web('b1')).toBe('web:b1')
    expect(runtimes.flatMap(r => r.mcpServers ?? []).map(s => s.name)).toEqual(['slack'])
    expect(runtimes.flatMap(r => r.notificationChannels ?? []).map(c => c.id)).toEqual(['slack'])
    await runtimes[1]!.chatFamilies!.platform!({} as never)
    for (const runtime of [...runtimes].reverse()) await runtime.onWorkspaceDeleted?.({ id: 'w1' } as never)
    expect(deleted).toEqual(['w1'])
    for (const runtime of [...runtimes].reverse()) await runtime.close?.()
    expect(closed).toEqual(['bots', 'slack'])
  })
})
