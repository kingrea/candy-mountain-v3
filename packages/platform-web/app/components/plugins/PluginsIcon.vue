<script setup lang="ts">
const props = defineProps<{ type: string }>()

const icon = computed(() => pluginIconFor(props.type))
</script>

<template>
  <!-- The adjacent plugin name labels the icon in every view. -->
  <span class="inline-flex size-5 shrink-0 items-center justify-center text-muted" aria-hidden="true">
    <AppIcon :icon="icon" class="size-full" />
  </span>
</template>
