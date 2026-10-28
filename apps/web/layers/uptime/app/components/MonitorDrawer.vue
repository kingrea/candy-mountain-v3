<script setup lang="ts">
import {
  projectMonitorChecksPath,
  projectMonitorIncidentsPath,
  type IncidentListResponse,
  type Monitor,
  type MonitorCheckListResponse,
  type MonitorCheckRecord,
  type MonitorIncident,
  type MonitorStatus,
} from '@candy-mountain/shared'

const props = defineProps<{
  status: MonitorStatus | null
  sourceLabel: string
  canManage: boolean
}>()

const open = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{
  edit: [monitor: Monitor]
  delete: [monitor: Monitor]
}>()

const { $api } = useNuxtApp()
const { slug } = useSelectedProject()

// The monitor stays rendered while the drawer animates shut after a delete or deselect.
const kept = ref<MonitorStatus | null>(props.status)
watch(() => props.status, (status) => {
  if (status) kept.value = status
})
const shown = computed(() => props.status ?? kept.value)
const monitor = computed(() => shown.value?.monitor ?? null)
const display = computed(() => (shown.value ? uptimeStateDisplay(shown.value) : null))

const checks = ref<MonitorCheckRecord[]>([])
const incidents = ref<MonitorIncident[]>([])
const loading = ref(false)
const failed = ref(false)

let generation = 0
async function load(id: string) {
  const current = slug.value
  if (!current) return
  const mine = ++generation
  try {
    const [checkList, incidentList] = await Promise.all([
      $api<MonitorCheckListResponse>(`${projectMonitorChecksPath(current, id)}?limit=${UPTIME_DRAWER_CHECKS}`),
      $api<IncidentListResponse>(`${projectMonitorIncidentsPath(current, id)}?limit=${UPTIME_CLOSED_INCIDENTS}`),
    ])
    if (mine !== generation) return
    checks.value = checkList.checks
    incidents.value = incidentList.incidents
    failed.value = false
  }
  catch {
    if (mine === generation) failed.value = true
  }
  finally {
    if (mine === generation) loading.value = false
  }
}

// A new check or an incident change arrives with the page's status poll, so the drawer refreshes only then.
watch(
  () => (open.value && props.status ? [props.status.monitor.id, props.status.lastCheck?.id, props.status.openIncident?.id].join() : null),
  (key, previous) => {
    if (!key || !import.meta.client) return
    const id = props.status!.monitor.id
    if (!previous || previous.split(',')[0] !== id) {
      checks.value = []
      incidents.value = []
      loading.value = true
    }
    void load(id)
  },
  { immediate: true },
)
watch(open, (isOpen) => {
  if (!isOpen) generation++
})
</script>

<template>
  <USlideover
    v-model:open="open"
    side="right"
    :title="monitor?.name ?? 'Monitor'"
    :description="monitor ? `${sourceLabel} · ${uptimeIntervalText(monitor.intervalSeconds)}` : undefined"
    :ui="{ content: 'max-w-lg', body: 'flex flex-col gap-6' }"
  >
    <template #body>
      <template v-if="shown && monitor && display">
        <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm" data-testid="drawer-details">
          <dt class="text-muted">
            State
          </dt>
          <dd>
            <UBadge :label="display.label" :color="display.color" variant="subtle" />
          </dd>
          <dt class="text-muted">
            Target
          </dt>
          <dd class="break-all">
            {{ monitor.target }}
          </dd>
          <template v-for="(value, key) in monitor.options" :key="key">
            <dt class="text-muted">
              {{ key }}
            </dt>
            <dd class="break-all">
              {{ value }}
            </dd>
          </template>
          <dt class="text-muted">
            Added
          </dt>
          <dd>
            <NuxtTime :datetime="monitor.createdAt" date-style="medium" time-style="short" />
          </dd>
        </dl>

        <UAlert
          v-if="failed"
          color="warning"
          variant="subtle"
          icon="i-lucide-wifi-off"
          title="Could not load this monitor's history."
        />

        <section class="flex flex-col gap-2" aria-labelledby="drawer-incidents-title">
          <h3 id="drawer-incidents-title" class="text-sm font-semibold text-highlighted">
            Incidents
          </h3>
          <USkeleton v-if="loading" class="h-12 w-full" />
          <ul v-else-if="incidents.length" class="divide-y divide-default rounded-lg border border-default" data-testid="drawer-incidents">
            <UptimeIncidentRow v-for="incident in incidents" :key="incident.id" :incident="incident" :monitor-name="monitor.name" hide-monitor />
          </ul>
          <p v-else class="text-sm text-muted">
            No incidents.
          </p>
        </section>

        <section class="flex flex-col gap-2" aria-labelledby="drawer-checks-title">
          <h3 id="drawer-checks-title" class="text-sm font-semibold text-highlighted">
            Recent checks
          </h3>
          <USkeleton v-if="loading" class="h-32 w-full" />
          <div v-else-if="checks.length" class="overflow-x-auto rounded-lg border border-default">
            <table class="w-full text-left text-sm" data-testid="drawer-checks">
              <thead class="text-muted">
                <tr>
                  <th scope="col" class="px-3 py-2 font-medium">
                    Time
                  </th>
                  <th scope="col" class="px-3 py-2 font-medium">
                    Result
                  </th>
                  <th scope="col" class="px-3 py-2 font-medium">
                    HTTP
                  </th>
                  <th scope="col" class="px-3 py-2 font-medium">
                    Latency
                  </th>
                  <th scope="col" class="px-3 py-2 font-medium">
                    Error
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr v-for="check in checks" :key="check.id" :data-ok="check.ok">
                  <td class="px-3 py-1.5 whitespace-nowrap">
                    <NuxtTime :datetime="check.checkedAt" date-style="short" time-style="medium" />
                  </td>
                  <td class="px-3 py-1.5">
                    <UBadge :label="check.ok ? 'OK' : check.status === 'degraded' ? 'Degraded' : 'Failed'" :color="check.ok ? 'success' : check.status === 'degraded' ? 'warning' : 'error'" variant="subtle" size="sm" />
                  </td>
                  <td class="px-3 py-1.5 tabular-nums">
                    {{ check.httpStatus ?? '-' }}
                  </td>
                  <td class="px-3 py-1.5 whitespace-nowrap tabular-nums">
                    {{ uptimeLatencyText(check.latencyMs) }}
                  </td>
                  <td class="max-w-48 truncate px-3 py-1.5 text-muted" :title="check.detail ?? undefined">
                    {{ check.detail ?? '' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="text-sm text-muted">
            No checks yet.
          </p>
        </section>
      </template>
    </template>

    <template v-if="canManage && monitor" #footer>
      <div class="flex gap-2">
        <UButton label="Edit" icon="i-lucide-pencil" color="neutral" variant="outline" data-testid="drawer-edit" @click="emit('edit', monitor)" />
        <UButton label="Delete" icon="i-lucide-trash-2" color="error" variant="soft" data-testid="drawer-delete" @click="emit('delete', monitor)" />
      </div>
    </template>
  </USlideover>
</template>
