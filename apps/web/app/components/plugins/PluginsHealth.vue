<script setup lang="ts">
import type { PluginInstanceHealth } from '@candy-mountain/shared'

defineProps<{
  health: PluginInstanceHealth | null
}>()
</script>

<template>
  <div
    class="flex items-start gap-2 rounded-md px-3 py-2 text-sm"
    :class="!health ? 'bg-elevated/50 text-muted' : health.healthy ? 'bg-success/10 text-success' : 'bg-error/10 text-error'"
    :data-health="!health ? 'untested' : health.healthy ? 'healthy' : 'unhealthy'"
    data-testid="plugin-health"
  >
    <UIcon
      :name="!health ? 'i-lucide-circle-dashed' : health.healthy ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
      class="mt-0.5 size-4 shrink-0"
    />
    <div class="min-w-0">
      <p v-if="!health">
        Not tested since it was last changed.
      </p>
      <template v-else>
        <p class="break-words font-medium">
          {{ health.healthy ? (health.detail || 'Connection works.') : health.reason }}
        </p>
        <p class="text-xs text-muted">
          Tested <NuxtTime :datetime="health.checkedAt" relative numeric="auto" title />
        </p>
      </template>
    </div>
  </div>
</template>
