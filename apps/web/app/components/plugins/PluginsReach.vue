<script setup lang="ts">
defineProps<{
  reach: readonly string[]
}>()
</script>

<template>
  <div data-testid="plugin-reach">
    <p class="text-xs font-medium text-toned">
      Once added, Candy Mountain can:
    </p>
    <ul class="mt-1 flex flex-col gap-1">
      <li v-for="line in reach" :key="line" class="flex items-start gap-2 text-sm text-default">
        <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-primary" />
        <span>{{ line }}</span>
      </li>
    </ul>
  </div>
</template>
