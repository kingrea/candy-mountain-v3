<script setup lang="ts">
import type { MonitorIncident } from '@candy-mountain/shared'

const props = defineProps<{
  incident: MonitorIncident
  monitorName: string
  /** Hides the monitor link where the monitor is already the context. */
  hideMonitor?: boolean
}>()

const emit = defineEmits<{
  select: [monitorId: string]
}>()

const isOpen = computed(() => props.incident.closedAt === null)
</script>

<template>
  <li class="flex flex-col gap-1 p-3 text-sm" :data-testid="`incident-${isOpen ? 'open' : 'closed'}`">
    <div class="flex flex-wrap items-center gap-2">
      <UBadge :label="isOpen ? 'Open' : 'Closed'" :color="isOpen ? 'error' : 'neutral'" variant="subtle" />
      <span v-if="hideMonitor" class="font-medium text-highlighted">{{ monitorName }}</span>
      <button
        v-else
        type="button"
        class="rounded-sm font-medium text-highlighted hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        data-testid="incident-monitor"
        @click="emit('select', incident.monitorId)"
      >
        {{ monitorName }}
      </button>
      <span class="text-muted">
        <NuxtTime :datetime="incident.openedAt" relative numeric="auto" title />
        · {{ isOpen ? 'ongoing for' : 'lasted' }} {{ uptimeDurationText(incident.openedAt, incident.closedAt) }}
      </span>
    </div>
    <p class="text-muted">
      {{ incident.reason }}
    </p>
  </li>
</template>
