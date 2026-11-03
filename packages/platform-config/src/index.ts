import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export interface Address {
  host: string
  port: number
}

export const DEFAULT_DAEMON_ADDRESS: Readonly<Address> = { host: '127.0.0.1', port: 4310 }
// Loopback because the web server proxies the whole daemon API and there is no auth in front of it yet.
export const DEFAULT_WEB_ADDRESS: Readonly<Address> = { host: '127.0.0.1', port: 4300 }

export function resolveDaemonAddress(env: NodeJS.ProcessEnv = process.env): Address {
  return {
    host: env.CM_DAEMON_HOST || DEFAULT_DAEMON_ADDRESS.host,
    port: parsePort('CM_DAEMON_PORT', env.CM_DAEMON_PORT, DEFAULT_DAEMON_ADDRESS.port),
  }
}

export function resolveWebAddress(env: NodeJS.ProcessEnv = process.env): Address {
  return {
    host: env.CM_WEB_HOST || DEFAULT_WEB_ADDRESS.host,
    port: parsePort('CM_WEB_PORT', env.CM_WEB_PORT, DEFAULT_WEB_ADDRESS.port),
  }
}

/** Structural so this package need not depend on the product configuration type. */
export interface DataDirProduct {
  readonly name: string
}

export function resolveDataDir(product: DataDirProduct, env: NodeJS.ProcessEnv = process.env): string {
  if (env.CM_DATA_DIR) return resolve(expandHome(env.CM_DATA_DIR))
  // ~/.candy-mountain belongs to v2, so v3 follows XDG instead of reusing it.
  const dataHome = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(homedir(), '.local', 'share')
  return join(dataHome, dataDirName(product.name))
}

export function dataDirName(productName: string): string {
  const name = productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!name) throw new Error(`Product name "${productName}" has no letters or digits to name a data directory with`)
  return name
}

export function addressUrl({ host, port }: Address): string {
  const target = connectHost(host)
  return `http://${target.includes(':') ? `[${target}]` : target}:${port}`
}

/** The host a client should dial for a server bound to `host`; wildcard binds are not connectable. */
export function connectHost(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::') return '::1'
  return host
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function parsePort(name: string, raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535, got "${raw}"`)
  }
  return port
}
