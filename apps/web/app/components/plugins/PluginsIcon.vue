<script setup lang="ts">
const props = defineProps<{ type: string }>()

const icon = computed(() => pluginIconFor(props.type))
</script>

<template>
  <!-- The adjacent plugin name labels the icon in every view. -->
  <span class="inline-flex size-5 shrink-0 items-center justify-center text-muted" aria-hidden="true">
    <img v-if="'src' in icon" :src="icon.src" alt="" class="size-full object-contain" :class="icon.class">
    <UIcon v-else :name="icon.name" class="size-full" />
  </span>
</template>
