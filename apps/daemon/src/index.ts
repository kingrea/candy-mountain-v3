import { serve } from '@hono/node-server'
import { PLATFORM_AGENT_ID, PRODUCT_NAME } from '@candy-mountain/shared'
import { createApp } from './app'
import { ADMIN_PASSWORD_ENV, applyAdminPassword, createAuthStrategy, requireAdminPassword } from './auth'
import { loadConfig } from './config'
import { createMastra } from './mastra'
import { createPlatformAgent, createPlatformAgentRunner } from './platform-agent'
import { startPlatform } from './platform'
import { SECRETS_KEY_ENV } from './secrets'

const config = loadConfig()
const platform = startPlatform(config.dataDir, { secretsKey: config.secretsKey, sessions: config.sessions, decisions: config.decisions, worktrees: config.worktrees, notifications: config.notifications, uptime: config.uptime })
console.log(`${PRODUCT_NAME} data directory ${platform.paths.root} (${platform.appliedMigrations} migration(s) applied)`)
if (!platform.secrets.unlocked) {
  console.warn(`${SECRETS_KEY_ENV} is not set: secrets are locked and cannot be saved or used until it is`)
}
const { mastra, close: closeMastra } = await createMastra(platform.paths, { agents: storage => ({ [PLATFORM_AGENT_ID]: createPlatformAgent({ storage }) }) })
const platformAgent = createPlatformAgentRunner({ db: platform.db, capabilities: platform.capabilities, modules: platform.modules, pluginTypes: platform.pluginTypes, secrets: platform.secrets.writeOnly, secretsReader: platform.secrets, mastra })

if (config.adminPassword) {
  const result = await applyAdminPassword(platform.db, config.adminPassword)
  console.log(`Admin password ${result === 'set' ? 'set' : 'unchanged'} from ${ADMIN_PASSWORD_ENV}`)
}
if (config.auth.strategy === 'password') requireAdminPassword(platform.db)
const auth = createAuthStrategy(config.auth)
console.log(`Auth strategy: ${auth.name}`)
console.log(`${platform.capabilities.list().length} capability manifest(s) registered`)
console.log(`${platform.pluginTypes.list().length} plugin type(s) registered`)
console.log(`${platform.modules.list().length} module(s) registered`)
const app = createApp({ db: platform.db, paths: platform.paths, auth, capabilities: platform.capabilities, modules: platform.modules, issueWatcher: platform.issueWatcher, secrets: platform.secrets.writeOnly, secretsReader: platform.secrets, pluginTypes: platform.pluginTypes, sessions: platform.sessions, decisions: platform.decisions, botSessions: platform.botSessions, slack: platform.slack, nativeFamilies: { platform: platformAgent } })

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`${PRODUCT_NAME} daemon listening on http://${info.address}:${info.port}`)
})

function shutdown() {
  // Open issue event streams would otherwise keep server.close waiting forever.
  platform.issueWatcher.close()
  const agentsStopped = platform.sessions.close().then(() => platform.acpHarness.close())
  server.close(() => {
    void agentsStopped.then(() => closeMastra()).finally(() => {
      platform.close()
      process.exit(0)
    })
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
