import { HEALTH_PATH, isDaemonUnreachableResponse } from '@candy-mountain/shared'

export const DAEMON_POLL_INTERVAL_MS = 3000

export interface DaemonStatus {
  unreachable: boolean
  daemonUrl: string
}

export function useDaemonStatus() {
  const status = useState<DaemonStatus>('daemon-status', () => ({ unreachable: false, daemonUrl: '' }))

  async function check() {
    try {
      await $fetch.raw(`/api${HEALTH_PATH}`, { retry: false })
      status.value = { unreachable: false, daemonUrl: '' }
    }
    catch (error) {
      reportDaemonError(status, error)
    }
  }

  return { status, check }
}

export function reportDaemonError(status: Ref<DaemonStatus>, error: unknown) {
  const response = (error as { response?: Response } | null)?.response
  if (!response || !isDaemonUnreachableResponse(response)) return
  const daemonUrl = (error as { data?: { daemonUrl?: unknown } }).data?.daemonUrl
  status.value = { unreachable: true, daemonUrl: typeof daemonUrl === 'string' ? daemonUrl : status.value.daemonUrl }
}
