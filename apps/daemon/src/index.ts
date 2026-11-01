import { serve } from '@hono/node-server'
import { createApp } from './app'
import { ADMIN_PASSWORD_ENV, applyAdminPassword, createAuthStrategy, requireAdminPassword } from './auth'
import { candyMountainProduct } from './candy-mountain'
import { loadConfig } from './config'
import { startPlatform } from './platform'
import { SECRETS_KEY_ENV } from './secrets'

const config = loadConfig()
const product = candyMountainProduct({ chatClaudeCode: { sessions: config.sessions, decisions: config.decisions }, bots: { worktrees: config.worktrees }, uptime: config.uptime })
const platform = startPlatform(config.dataDir, { secretsKey: config.secretsKey, product, notifications: config.notifications })
const { name } = product.config
console.log(`${name} data directory ${platform.paths.root} (${platform.appliedMigrations} migration(s) applied)`)
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
const app = createApp({ db: platform.db, paths: platform.paths, auth, product, capabilities: platform.capabilities, modules: platform.modules, secrets: platform.secrets.writeOnly, secretsReader: platform.secrets, pluginTypes: platform.pluginTypes, families: platform.families, runtime: platform.runtime })

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`${name} daemon listening on http://${info.address}:${info.port}`)
})

function shutdown() {
  // Open issue and session event streams would otherwise keep server.close waiting forever, so the definitions (the issue watcher and agent sessions among them) stop first.
  const stopped = platform.runtime.close()
  server.close(() => {
    void stopped.finally(() => void platform.close().finally(() => process.exit(0)))
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
