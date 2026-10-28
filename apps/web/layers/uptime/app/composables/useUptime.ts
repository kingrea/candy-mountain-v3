import {
  MONITOR_SOURCES_PATH,
  projectUptimeStatusPath,
  type MonitorSourceListResponse,
  type UptimeStatusResponse,
} from '@candy-mountain/shared'

export function useUptimeSources() {
  const request = useApi<MonitorSourceListResponse>(MONITOR_SOURCES_PATH, { key: UPTIME_SOURCES_DATA_KEY })
  return { ...request, sources: computed(() => request.data.value?.sources ?? []) }
}

/**
 * The whole page's monitors, states and recent checks from one request, re-polled every UPTIME_POLL_MS while the tab
 * is visible. A failed poll keeps the last answer on screen and sets `stale`.
 */
export function useUptimeStatus() {
  const { slug, project } = useSelectedProject()
  const { $api } = useNuxtApp()
  const path = (current: string) => `${projectUptimeStatusPath(current)}?recent=${UPTIME_HISTORY_LENGTH}`

  const request = useAsyncData(
    () => uptimeStatusDataKey(slug.value),
    () => (slug.value ? $api<UptimeStatusResponse>(path(slug.value)) : Promise.resolve({ monitors: [] })),
  )

  const stale = ref(false)

  async function refresh() {
    const current = slug.value
    if (!current) return
    try {
      const response = await $api<UptimeStatusResponse>(path(current))
      if (slug.value !== current) return
      request.data.value = response
      stale.value = false
    }
    catch {
      if (slug.value === current) stale.value = true
    }
  }

  // Each tick waits for the previous answer, so a slow daemon never stacks requests.
  let timer: ReturnType<typeof setTimeout> | null = null
  let active = false
  const stop = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  const schedule = () => {
    stop()
    if (active && !document.hidden) timer = setTimeout(tick, UPTIME_POLL_MS)
  }
  async function tick() {
    await refresh()
    schedule()
  }
  const onVisibility = () => {
    if (document.hidden) return stop()
    void tick()
  }

  onMounted(() => {
    active = true
    document.addEventListener('visibilitychange', onVisibility)
    schedule()
  })
  onScopeDispose(() => {
    active = false
    stop()
    if (import.meta.client) document.removeEventListener('visibilitychange', onVisibility)
  })
  watch(slug, () => {
    stale.value = false
    schedule()
  })

  // Nuxt seeds a new key with the previous key's data, so another project's monitors are filtered out.
  const statuses = computed(() =>
    (request.data.value?.monitors ?? []).filter(status => status.monitor.projectId === project.value?.id),
  )

  return {
    statuses,
    status: request.status,
    error: request.error,
    stale,
    /** Re-reads now, e.g. after a write; the next poll is pushed back a full interval. */
    refresh: tick,
  }
}

/** The selected monitor lives in `?monitor=`, the link activity events use, so a reload or a shared link keeps it. */
export function useUptimeSelection() {
  const route = useRoute()
  const router = useRouter()

  const monitorId = computed(() => {
    const value = route.query[UPTIME_MONITOR_QUERY]
    return typeof value === 'string' && value ? value : null
  })

  function select(id: string | null) {
    const { [UPTIME_MONITOR_QUERY]: _previous, ...rest } = route.query
    return router.replace({ query: id ? { ...rest, [UPTIME_MONITOR_QUERY]: id } : rest })
  }

  return { monitorId, select, clear: () => select(null) }
}

export type UptimeSelection = ReturnType<typeof useUptimeSelection>
