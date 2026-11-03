import { resolveDaemonAddress, resolveDataDir, type DataDirProduct } from '@candy-mountain/platform-config'
import { ADMIN_PASSWORD_ENV, type AuthConfig, MasterKey, type NotificationSettings, resolveAuthConfig, resolveNotificationSettings } from '@candy-mountain/platform-daemon'
import { resolveDecisionSettings, type DecisionSettings } from './decisions/config'
import { resolveSessionSettings, type SessionSettings } from './sessions/config'
import { resolveWorktreeSettings, type WorktreeSettings } from './worktrees/config'
import { resolveUptimeSettings, type UptimeSettings } from './uptime/config'

export { resolveDataDir }

export interface DaemonConfig {
  host: string
  port: number
  dataDir: string
  secretsKey: MasterKey | undefined
  auth: AuthConfig
  adminPassword: string | undefined
  sessions: SessionSettings
  decisions: DecisionSettings
  worktrees: WorktreeSettings
  notifications: NotificationSettings
  uptime: UptimeSettings
}

export function loadConfig(product: DataDirProduct, env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  return {
    ...resolveDaemonAddress(env),
    dataDir: resolveDataDir(product, env),
    secretsKey: env.CM_SECRETS_KEY ? MasterKey.parse(env.CM_SECRETS_KEY) : undefined,
    auth: resolveAuthConfig(env),
    adminPassword: env[ADMIN_PASSWORD_ENV] || undefined,
    sessions: resolveSessionSettings(env),
    decisions: resolveDecisionSettings(env),
    worktrees: resolveWorktreeSettings(env),
    notifications: resolveNotificationSettings(env),
    uptime: resolveUptimeSettings(env),
  }
}
