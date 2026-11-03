<template>
  <span class="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-default ring-inset" :style="{ backgroundColor: color }" aria-hidden="true" />
</template>

<script setup lang="ts">
defineProps<{ color: string }>()
</script>
