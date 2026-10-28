<script setup lang="ts">
import { projectMonitorPath, type Monitor, type MonitorResponse } from '@candy-mountain/shared'
import ProjectsConfirmModal from '~/components/projects/ProjectsConfirmModal.vue'

defineProps<{
  canManage: boolean
}>()

/** `null` opens the editor for a new monitor, `undefined` closes it. */
const editing = defineModel<Monitor | null | undefined>('editing')

const { $api } = useNuxtApp()
const { slug } = useSelectedProject()
const toast = useToast()
const confirm = useOverlay().create(ProjectsConfirmModal)

const { sources } = useUptimeSources()
const { statuses, status, error: loadError, stale, refresh } = useUptimeStatus()
const selection = useUptimeSelection()

const actionError = ref<ApiErrorInfo | null>(null)
const toggling = ref<ReadonlySet<string>>(new Set())

const editorOpen = computed({
  get: () => editing.value !== undefined,
  set: (open) => {
    if (!open) editing.value = undefined
  },
})
// Kept while the editor closes so its title does not flip to "New monitor" mid-animation.
const editorMonitor = ref<Monitor | null>(null)
watch(editing, (monitor) => {
  if (monitor !== undefined) editorMonitor.value = monitor
})

const loaded = computed(() => status.value === 'success' || statuses.value.length > 0)
const selectedMissing = computed(() =>
  Boolean(selection.monitorId.value) && loaded.value && !statuses.value.some(entry => entry.monitor.id === selection.monitorId.value),
)

const selectedStatus = computed(() => statuses.value.find(entry => entry.monitor.id === selection.monitorId.value) ?? null)
const drawerOpen = computed({
  get: () => selectedStatus.value !== null,
  set: (open) => {
    if (!open) void selection.clear()
  },
})

// Scrolls once per selection, not on every poll that re-renders the card.
let scrolledTo: string | null = null
watch([selection.monitorId, () => statuses.value.length], async ([id]) => {
  if (!import.meta.client || !id || id === scrolledTo) return
  await nextTick()
  const card = document.getElementById(uptimeCardId(id))
  if (!card) return
  scrolledTo = id
  card.scrollIntoView({ block: 'center', behavior: 'smooth' })
}, { immediate: true, flush: 'post' })

async function onSaved(monitor: Monitor, created: boolean) {
  actionError.value = null
  toast.add({ title: created ? `Added ${monitor.name}` : `Saved ${monitor.name}`, color: 'success' })
  await refresh()
}

async function toggle(monitor: Monitor, enabled: boolean) {
  if (!slug.value) return
  actionError.value = null
  toggling.value = new Set([...toggling.value, monitor.id])
  try {
    await $api<MonitorResponse>(`${projectMonitorPath(slug.value, monitor.id)}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' })
    await refresh()
  }
  catch (error) {
    actionError.value = toApiError(error)
  }
  finally {
    toggling.value = new Set([...toggling.value].filter(id => id !== monitor.id))
  }
}

async function remove(monitor: Monitor) {
  const confirmed = await confirm.open({
    title: `Delete ${monitor.name}?`,
    description: 'The monitor, its check history and its incidents are removed.',
    confirmLabel: 'Delete monitor',
  }).result
  if (!confirmed || !slug.value) return
  actionError.value = null
  try {
    await $api(projectMonitorPath(slug.value, monitor.id), { method: 'DELETE' })
    toast.add({ title: `Deleted ${monitor.name}`, color: 'success' })
    if (selection.monitorId.value === monitor.id) await selection.clear()
  }
  catch (error) {
    actionError.value = toApiError(error)
  }
  await refresh()
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <section class="flex flex-col gap-4" aria-labelledby="monitors-title">
      <h2 id="monitors-title" class="sr-only">
        Monitors
      </h2>

      <UAlert
        v-if="actionError"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="actionError.message"
        :close="{ onClick: () => { actionError = null } }"
        data-testid="action-error"
      />
      <UAlert
        v-if="loadError && !statuses.length"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Could not load monitors"
        :description="toApiError(loadError).message"
      />
      <UAlert
        v-else-if="stale"
        color="warning"
        variant="subtle"
        icon="i-lucide-wifi-off"
        title="Could not refresh; showing the last known state and retrying."
        data-testid="stale"
      />
      <UAlert
        v-if="selectedMissing"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        title="That monitor no longer exists."
        :close="{ onClick: () => selection.clear() }"
        data-testid="selected-missing"
      />

      <div v-if="!loaded && !loadError" class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        <USkeleton v-for="n in 2" :key="n" class="h-56 w-full" />
      </div>
      <div v-else-if="statuses.length" class="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3" data-testid="monitor-cards">
        <UptimeMonitorCard
          v-for="entry in statuses"
          :key="entry.monitor.id"
          :status="entry"
          :source-label="uptimeSourceLabel(sources, entry.monitor.sourceType)"
          :can-manage="canManage"
          :highlighted="entry.monitor.id === selection.monitorId.value"
          :toggling="toggling.has(entry.monitor.id)"
          @select="selection.select($event.id)"
          @edit="editing = $event"
          @delete="remove"
          @toggle="toggle"
        />
      </div>
      <UEmpty
        v-else-if="!loadError"
        icon="i-lucide-heart-pulse"
        title="No monitors yet"
        :description="canManage ? 'Add a monitor to check a site or a vendor status page on a schedule.' : 'An admin can add the project\'s monitors here.'"
        :actions="canManage ? [{ label: 'New monitor', icon: 'i-lucide-plus', onClick: () => { editing = null } }] : []"
      />
    </section>

    <UptimeIncidents :statuses="statuses" />

    <UptimeMonitorDrawer
      v-model:open="drawerOpen"
      :status="selectedStatus"
      :source-label="selectedStatus ? uptimeSourceLabel(sources, selectedStatus.monitor.sourceType) : ''"
      :can-manage="canManage"
      @edit="editing = $event"
      @delete="remove"
    />

    <UptimeEditorModal
      v-if="canManage"
      v-model:open="editorOpen"
      :monitor="editorMonitor"
      :sources="sources"
      @saved="onSaved"
    />
  </div>
</template>
