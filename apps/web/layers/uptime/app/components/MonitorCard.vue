<script setup lang="ts">
import type { Monitor, MonitorStatus } from '@candy-mountain/shared'

const props = defineProps<{
  status: MonitorStatus
  sourceLabel: string
  canManage: boolean
  highlighted?: boolean
  /** An enable or disable request for this monitor is in flight. */
  toggling?: boolean
}>()

const emit = defineEmits<{
  select: [monitor: Monitor]
  edit: [monitor: Monitor]
  delete: [monitor: Monitor]
  toggle: [monitor: Monitor, enabled: boolean]
}>()

const monitor = computed(() => props.status.monitor)
const display = computed(() => uptimeStateDisplay(props.status))
const lastCheck = computed(() => props.status.lastCheck)
</script>

<template>
  <UCard
    :id="uptimeCardId(monitor.id)"
    class="scroll-mt-4 transition-shadow"
    :class="[highlighted ? 'ring-2 ring-primary' : '', monitor.enabled ? '' : 'opacity-75']"
    :ui="{ body: 'flex flex-col gap-3' }"
    :data-testid="`monitor-card-${monitor.name}`"
    :data-state="status.state"
    :data-enabled="monitor.enabled"
  >
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <button
          type="button"
          class="flex min-w-0 items-center gap-2 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-primary"
          data-testid="monitor-select"
          @click="emit('select', monitor)"
        >
          <UIcon :name="display.icon" class="size-5 shrink-0" :class="display.iconClass" />
          <h3 class="truncate font-semibold text-highlighted hover:underline">
            {{ monitor.name }}
          </h3>
        </button>
        <div class="flex shrink-0 items-center gap-1.5">
          <UBadge :label="sourceLabel" color="neutral" variant="outline" data-testid="monitor-type" />
          <UBadge :label="display.label" :color="display.color" variant="subtle" data-testid="monitor-state" />
        </div>
      </div>
    </template>

    <p class="truncate text-sm text-muted" :title="monitor.target">
      {{ uptimeTargetText(monitor.target) }} · {{ uptimeIntervalText(monitor.intervalSeconds) }}
    </p>

    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      <dt class="text-muted">
        Latency
      </dt>
      <dd data-testid="monitor-latency">
        <span v-if="lastCheck" class="tabular-nums">{{ uptimeLatencyText(lastCheck.latencyMs) }}</span>
        <span v-else class="text-muted">No checks yet</span>
      </dd>
      <dt class="text-muted">
        Checked
      </dt>
      <dd data-testid="monitor-checked">
        <NuxtTime v-if="lastCheck" :datetime="lastCheck.checkedAt" relative numeric="auto" title />
        <span v-else class="text-muted">{{ monitor.enabled ? 'Waiting for the first check' : 'Never' }}</span>
      </dd>
    </dl>

    <p v-if="status.openIncident" class="text-sm text-error" data-testid="monitor-incident">
      Down since <NuxtTime :datetime="status.openIncident.openedAt" relative numeric="auto" title />: {{ status.openIncident.reason }}
    </p>
    <p v-else-if="lastCheck?.detail" class="truncate text-sm text-muted" :title="lastCheck.detail" data-testid="monitor-detail">
      {{ lastCheck.detail }}
    </p>

    <UptimeHistoryStrip :checks="status.recentChecks" />

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <USwitch
          v-if="canManage"
          :model-value="monitor.enabled"
          :loading="toggling"
          :disabled="toggling"
          :label="monitor.enabled ? 'Enabled' : 'Disabled'"
          data-testid="monitor-enabled"
          @update:model-value="emit('toggle', monitor, $event)"
        />
        <span v-else class="text-sm text-muted">{{ monitor.enabled ? 'Enabled' : 'Disabled' }}</span>
        <div v-if="canManage" class="flex gap-2">
          <UButton label="Edit" icon="i-lucide-pencil" color="neutral" variant="outline" size="sm" data-testid="monitor-edit" @click="emit('edit', monitor)" />
          <UButton label="Delete" icon="i-lucide-trash-2" color="error" variant="soft" size="sm" data-testid="monitor-delete" @click="emit('delete', monitor)" />
        </div>
      </div>
    </template>
  </UCard>
</template>
