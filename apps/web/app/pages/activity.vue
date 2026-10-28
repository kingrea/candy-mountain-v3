<template>
  <UDashboardPanel id="activity">
    <template #header>
      <UDashboardNavbar title="Activity" />
    </template>

    <template #body>
      <div class="flex max-w-3xl flex-col gap-4">
        <div class="flex flex-wrap gap-2">
          <USelect v-model="type" :items="typeItems" class="w-48" aria-label="Event type" data-testid="activity-type" />
          <USelect v-model="range" :items="rangeItems" class="w-48" aria-label="Time range" data-testid="activity-range" />
        </div>
        <ActivityFeed :type="type === 'all' ? undefined : type" :since="since" />
      </div>
    </template>
  </UDashboardPanel>
</template>

<script setup lang="ts">
import { ACTIVITY_EVENT_TYPES, type ActivityEventType } from '@candy-mountain/shared'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Activity' })

const type = ref<ActivityEventType | 'all'>('all')
const range = ref<(typeof ACTIVITY_SINCE_OPTIONS)[number]['value']>('all')

const typeItems = [
  { label: 'All types', value: 'all' },
  ...ACTIVITY_EVENT_TYPES.map(value => ({ label: ACTIVITY_EVENT_KINDS[value].label, value })),
]
const rangeItems = ACTIVITY_SINCE_OPTIONS.map(({ label, value }) => ({ label, value }))

// Computed when the range changes, not per render, so the fetch key stays stable between filter edits.
const since = ref<string>()
watch(range, (value) => {
  const hours = ACTIVITY_SINCE_OPTIONS.find(option => option.value === value)?.hours
  since.value = hours ? new Date(Date.now() - hours * 3_600_000).toISOString() : undefined
})
</script>
