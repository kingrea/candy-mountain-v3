import { DAEMON_UNREACHABLE_HEADER, type DaemonUnreachableBody } from '@candy-mountain/shared'
import { getRequestHeader, proxyRequest, setResponseHeader, setResponseStatus, type H3Event } from 'h3'

export const API_PREFIX = '/api'

const DEFAULT_DAEMON_HOST = '127.0.0.1'
const DEFAULT_DAEMON_PORT = '4310'

export function resolveDaemonUrl(configured: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (configured) return configured.replace(/\/+$/, '')
  const host = env.CM_DAEMON_HOST || DEFAULT_DAEMON_HOST
  const port = env.CM_DAEMON_PORT || DEFAULT_DAEMON_PORT
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`
}

export function toDaemonPath(apiPath: string): string {
  const rest = apiPath.slice(API_PREFIX.length)
  return rest.startsWith('/') ? rest : `/${rest}`
}

export async function proxyToDaemon(event: H3Event, daemonUrl: string) {
  const res = event.node.res
  const upstream = new AbortController()
  // A closed SSE tab would otherwise hold the daemon stream open forever.
  res.once('close', () => {
    if (!res.writableFinished) upstream.abort()
  })

  // h3 drops Accept from proxied requests, which breaks SSE negotiation.
  const accept = getRequestHeader(event, 'accept')

  try {
    return await proxyRequest(event, `${daemonUrl}${toDaemonPath(event.path)}`, {
      headers: accept ? { accept } : undefined,
      fetchOptions: { signal: upstream.signal },
    })
  }
  catch {
    if (upstream.signal.aborted) return
    // A daemon that answered, even with 5xx, is returned by proxyRequest; only a failed connection throws.
    setResponseStatus(event, 502)
    setResponseHeader(event, DAEMON_UNREACHABLE_HEADER, '1')
    const body: DaemonUnreachableBody = {
      error: { code: 'daemon_unreachable', message: 'The daemon could not be reached.' },
      daemonUrl,
    }
    return body
  }
}
