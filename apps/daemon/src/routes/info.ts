import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { InfoResponse } from '@candy-mountain/shared'
import type { AppEnv } from '../app'
import { PACKAGE_ROOT } from '../package-root'

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version: string }
  return pkg.version
}

export function infoRoutes() {
  const version = readVersion()
  const routes = new Hono<AppEnv>()
  routes.get('/', c => c.json<InfoResponse>({
    version,
    dataDir: c.get('paths').root,
    authStrategy: c.var.authStrategy,
  }))
  return routes
}
