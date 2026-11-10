import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WORKSPACES_PATH, type Actor, type ApiErrorBody } from '@crab-shack/platform-sdk'
import { MONITOR_SOURCES_PATH, type MonitorSourceListResponse } from './wire'
import { defineCapabilityDefinition, type CapabilityRuntime } from '@crab-shack/platform-sdk/daemon'
import { ensureDataDir, type AppEnv, type PlatformDatabase } from '@crab-shack/platform-daemon'
import { fixtureCapability, fixtureCapabilityContext } from '@crab-shack/platform-daemon/testing'
import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { openUptimeDatabase } from './test-support'
import { monitorRoutes, monitorSourceRoutes, startIncidentTracker, startUptimeScheduler, type IncidentTracker, type UptimeScheduler } from '.'

describe('a definition written with the helper alone', () => {
  let database: PlatformDatabase | undefined
  let root: string | undefined
  const open: CapabilityRuntime[] = []

  afterEach(async () => {
    for (const runtime of open.splice(0).reverse()) await runtime.close?.()
    database?.close()
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('expresses uptime with the helper alone: routes, services and close', async () => {
    database = openUptimeDatabase()
    root = mkdtempSync(join(tmpdir(), 'candy-mountain-definition-'))
    const paths = ensureDataDir(join(root, 'data'), 'Candy Mountain')

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
    for (const routes of runtime.workspaceRoutes ?? []) app.route(WORKSPACES_PATH, routes)
    for (const { path, routes } of runtime.platformRoutes ?? []) app.route(path, routes)

    const sources = await app.request(MONITOR_SOURCES_PATH)
    expect(sources.status).toBe(200)
    expect(((await sources.json()) as MonitorSourceListResponse).sources.length).toBeGreaterThan(0)
    const monitors = await app.request(`${WORKSPACES_PATH}/nope/monitors`)
    expect(monitors.status).toBe(404)
    expect(((await monitors.json()) as ApiErrorBody).error.code).toBe('not_found')
  })
})
