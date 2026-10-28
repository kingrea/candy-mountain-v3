<script setup lang="ts">
import type { MonitorCheckRecord } from '@candy-mountain/shared'

const props = defineProps<{
  /** Newest first, as the daemon sends them. */
  checks: MonitorCheckRecord[]
}>()

const bars = computed(() => uptimeHistoryBars(props.checks))
// Local time differs between the server and the browser, so it joins the title only after hydration.
const mounted = ref(false)
onMounted(() => (mounted.value = true))
const summary = computed(() => {
  const checks = props.checks.slice(0, UPTIME_HISTORY_LENGTH)
  if (!checks.length) return 'No checks yet'
  const failed = checks.filter(check => check.status !== 'up').length
  const label = checks.length === 1 ? 'Last check' : `Last ${checks.length} checks`
  return `${label}: ${checks.length - failed} up, ${failed} not up`
})

const BAR_CLASSES: Record<UptimeColor, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  neutral: 'bg-accented',
}
</script>

<template>
  <div class="flex h-6 items-stretch gap-px" role="img" :aria-label="summary" data-testid="history-strip">
    <template v-for="bar in bars" :key="bar.key">
      <span v-if="bar.kind === 'empty'" class="flex-1 rounded-xs bg-elevated" />
      <span
        v-else
        class="flex-1 rounded-xs"
        :class="BAR_CLASSES[bar.color]"
        :title="mounted ? `${new Date(bar.check.checkedAt).toLocaleString()} · ${bar.label}` : bar.label"
        :data-status="bar.check.status"
      />
    </template>
  </div>
</template>
