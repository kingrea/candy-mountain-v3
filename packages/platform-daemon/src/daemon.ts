import { resolveDaemonAddress, resolveDataDir, type DataDirProduct } from '@candy-mountain/platform-config'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { ADMIN_PASSWORD_ENV, applyAdminPassword, type AuthConfig, createAuthStrategy, requireAdminPassword, resolveAuthConfig } from './auth'
import { resolveNotificationSettings, type NotificationSettings } from './notifications/config'
import { startPlatform } from './platform'
import type { Product } from './product'
import { MasterKey, SECRETS_KEY_ENV } from './secrets'

export interface DaemonConfig {
  host: string
  port: number
  dataDir: string
  secretsKey: MasterKey | undefined
  auth: AuthConfig
  adminPassword: string | undefined
  notifications: NotificationSettings
}

/** The platform's own settings; a capability reads its settings in its definition's start. */
export function loadDaemonConfig(product: DataDirProduct, env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  return {
    ...resolveDaemonAddress(env),
    dataDir: resolveDataDir(product, env),
    secretsKey: env[SECRETS_KEY_ENV] ? MasterKey.parse(env[SECRETS_KEY_ENV]) : undefined,
    auth: resolveAuthConfig(env),
    adminPassword: env[ADMIN_PASSWORD_ENV] || undefined,
    notifications: resolveNotificationSettings(env),
  }
}

export async function runDaemon(product: Product, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = loadDaemonConfig(product.config, env)
  const platform = startPlatform(config.dataDir, { secretsKey: config.secretsKey, product, notifications: config.notifications })
  const { name } = product.config
  console.log(`${name} data directory ${platform.paths.root}`)
  console.log(`${platform.migrationSets.length} migration set(s) applied: ${platform.migrationSets.map(set => `${set.id} (${set.applied} migration(s))`).join(', ')}`)
  if (!platform.secrets.unlocked) {
    console.warn(`${SECRETS_KEY_ENV} is not set: secrets are locked and cannot be saved or used until it is`)
  }
  if (config.adminPassword) {
    const result = await applyAdminPassword(platform.db, config.adminPassword)
    console.log(`Admin password ${result === 'set' ? 'set' : 'unchanged'} from ${ADMIN_PASSWORD_ENV}`)
  }
  if (config.auth.strategy === 'password') requireAdminPassword(platform.db)
  const auth = createAuthStrategy(config.auth)
  console.log(`Auth strategy: ${auth.name}`)
  const registered = (what: string, ids: readonly string[]) => console.log(`${ids.length} ${what} registered: ${ids.join(', ')}`)
  registered('capability(ies)', product.capabilities.map(c => c.id))
  registered('module(s)', platform.modules.list().map(m => m.id))
  registered('plugin type(s)', platform.pluginTypes.list().map(t => t.id))
  registered('session family(ies)', platform.families.list().map(f => f.id))
  const app = createApp({ db: platform.db, paths: platform.paths, auth, product, capabilities: platform.capabilities, modules: platform.modules, secrets: platform.secrets.writeOnly, secretsReader: platform.secrets, pluginTypes: platform.pluginTypes, families: platform.families, workspaceFacts: platform.workspaceFacts, runtime: platform.runtime })

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    console.log(`${name} daemon listening on http://${info.address}:${info.port}`)
  })

  function shutdown() {
    // Open event streams would otherwise keep server.close waiting forever, so the definitions (watchers and agent sessions among them) stop first.
    const stopped = platform.runtime.close()
    server.close(() => {
      void stopped.finally(() => void platform.close().finally(() => process.exit(0)))
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
