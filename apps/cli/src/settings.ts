import { join } from 'node:path'
import { addressUrl, resolveDaemonAddress, resolveDataDir, resolveWebAddress, type Address } from '@candy-mountain/config'
import { HEALTH_PATH } from '@candy-mountain/shared'

export type ServiceName = 'daemon' | 'web'

export interface Service {
  name: ServiceName
  entry: string
  cwd: string
  address: Address
  url: string
  healthUrl: string
  pidFile: string
  logFile: string
  env: NodeJS.ProcessEnv
}

export interface Settings {
  dataDir: string
  logsDir: string
  runDir: string
  /** In start order; stop in reverse. */
  services: [Service, Service]
}

export function resolveSettings(repoRoot: string, env: NodeJS.ProcessEnv = process.env): Settings {
  const dataDir = resolveDataDir(env)
  const logsDir = join(dataDir, 'logs')
  const runDir = join(dataDir, 'run')
  const daemonAddress = resolveDaemonAddress(env)
  const webAddress = resolveWebAddress(env)
  const daemonUrl = addressUrl(daemonAddress)
  const webUrl = addressUrl(webAddress)

  // Pass absolute, resolved values so both children agree regardless of their own cwd.
  const shared: NodeJS.ProcessEnv = {
    ...env,
    CM_DATA_DIR: dataDir,
    CM_DAEMON_HOST: daemonAddress.host,
    CM_DAEMON_PORT: String(daemonAddress.port),
  }

  const daemonDir = join(repoRoot, 'apps', 'daemon')
  const webDir = join(repoRoot, 'apps', 'web')

  return {
    dataDir,
    logsDir,
    runDir,
    services: [
      {
        name: 'daemon',
        entry: join(daemonDir, 'dist', 'index.mjs'),
        cwd: daemonDir,
        address: daemonAddress,
        url: daemonUrl,
        healthUrl: `${daemonUrl}${HEALTH_PATH}`,
        pidFile: join(runDir, 'daemon.pid'),
        logFile: join(logsDir, 'daemon.log'),
        env: shared,
      },
      {
        name: 'web',
        entry: join(webDir, '.output', 'server', 'index.mjs'),
        cwd: webDir,
        address: webAddress,
        url: webUrl,
        // Going through the proxy proves the web server can reach the daemon, not just that it is listening.
        healthUrl: `${webUrl}/api${HEALTH_PATH}`,
        pidFile: join(runDir, 'web.pid'),
        logFile: join(logsDir, 'web.log'),
        env: {
          ...shared,
          // Nitro prefers the NITRO_ variants, so set both in case the shell already has one.
          HOST: webAddress.host,
          PORT: String(webAddress.port),
          NITRO_HOST: webAddress.host,
          NITRO_PORT: String(webAddress.port),
          NUXT_DAEMON_URL: daemonUrl,
        },
      },
    ],
  }
}
