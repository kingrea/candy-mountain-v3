<script setup lang="ts">
defineProps<{ refreshing: boolean, lost: boolean }>()
</script>

<template>
  <div class="ms-auto flex items-center gap-3 text-xs text-muted" role="status" aria-live="polite">
    <span v-if="lost" class="flex items-center gap-1 text-warning" data-testid="issues-live-lost">
      <UIcon name="i-lucide-wifi-off" class="size-4" />
      Live updates paused, reconnecting
    </span>
    <span v-if="refreshing" class="flex items-center gap-1" data-testid="issues-refreshing">
      <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
      Refreshing
    </span>
  </div>
</template>
