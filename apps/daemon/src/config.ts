import { resolveDaemonAddress, resolveDataDir } from '@candy-mountain/config'
import { resolveAuthConfig, type AuthConfig } from './auth/config'
import { ADMIN_PASSWORD_ENV } from './auth/passwords'
import { MasterKey } from './secrets/master-key'
import { resolveDecisionSettings, type DecisionSettings } from './decisions/config'
import { resolveSessionSettings, type SessionSettings } from './sessions/config'
import { resolveWorktreeSettings, type WorktreeSettings } from './worktrees/config'
import { resolveNotificationSettings, type NotificationSettings } from './notifications/config'
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  return {
    ...resolveDaemonAddress(env),
    dataDir: resolveDataDir(env),
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
