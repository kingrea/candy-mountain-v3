export const DAEMON_UNREACHABLE_HEADER = 'x-cm-daemon-unreachable'

export interface DaemonUnreachableBody {
  error: {
    code: 'daemon_unreachable'
    message: string
  }
  daemonUrl: string
}

export function isDaemonUnreachableResponse(response: { status: number, headers: { get(name: string): string | null } }): boolean {
  return response.status === 502 && response.headers.get(DAEMON_UNREACHABLE_HEADER) === '1'
}

export function isDaemonUnreachableBody(value: unknown): value is DaemonUnreachableBody {
  if (typeof value !== 'object' || value === null) return false
  const { error, daemonUrl } = value as { error?: { code?: unknown }, daemonUrl?: unknown }
  return error?.code === 'daemon_unreachable' && typeof daemonUrl === 'string'
}
