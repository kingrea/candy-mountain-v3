<script setup lang="ts">
import { projectUptimeIncidentsPath, type IncidentListResponse, type Monitor, type MonitorIncident, type MonitorStatus } from '@candy-mountain/shared'

const props = defineProps<{
  statuses: MonitorStatus[]
}>()

const { $api } = useNuxtApp()
const { slug } = useSelectedProject()
const selection = useUptimeSelection()

const open = computed(() => uptimeOpenIncidents(props.statuses))
const names = computed(() => new Map<string, Monitor['name']>(props.statuses.map(status => [status.monitor.id, status.monitor.name])))

// Open incidents come from the status poll already; only the closed ones need a request.
const closed = ref<MonitorIncident[]>([])
const loaded = ref(false)
const failed = ref(false)

async function loadClosed() {
  const current = slug.value
  if (!current) return
  try {
    const response = await $api<IncidentListResponse>(`${projectUptimeIncidentsPath(current)}?status=closed&limit=${UPTIME_CLOSED_INCIDENTS}`)
    if (slug.value !== current) return
    closed.value = response.incidents
    failed.value = false
    loaded.value = true
  }
  catch {
    if (slug.value === current) failed.value = true
  }
}

// An incident closing drops out of the open set, so this also refreshes the closed list on recovery.
watch(
  [slug, () => open.value.map(incident => incident.id).join()],
  () => { if (import.meta.client) void loadClosed() },
  { immediate: true },
)
</script>

<template>
  <section class="flex flex-col gap-3" aria-labelledby="uptime-incidents-title" data-testid="uptime-incidents">
    <h2 id="uptime-incidents-title" class="text-sm font-semibold text-highlighted">
      Incidents
    </h2>

    <UAlert
      v-if="failed"
      color="warning"
      variant="subtle"
      icon="i-lucide-wifi-off"
      title="Could not load recent incidents."
    />

    <ul v-if="open.length || closed.length" class="divide-y divide-default rounded-lg border border-default">
      <UptimeIncidentRow
        v-for="incident in open"
        :key="incident.id"
        :incident="incident"
        :monitor-name="names.get(incident.monitorId) ?? 'Deleted monitor'"
        @select="selection.select($event)"
      />
      <UptimeIncidentRow
        v-for="incident in closed"
        :key="incident.id"
        :incident="incident"
        :monitor-name="names.get(incident.monitorId) ?? 'Deleted monitor'"
        @select="selection.select($event)"
      />
    </ul>
    <p v-else-if="loaded" class="text-sm text-muted" data-testid="incidents-empty">
      No incidents yet.
    </p>
  </section>
</template>
