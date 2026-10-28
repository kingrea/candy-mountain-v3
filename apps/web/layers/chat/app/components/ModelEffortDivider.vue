<template>
  <USeparator :label="label" class="py-1" :ui="{ label: 'text-xs font-normal text-muted' }" data-testid="chat-session-divider" />
</template>

<script setup lang="ts">
defineProps<{ label: string }>()
</script>
