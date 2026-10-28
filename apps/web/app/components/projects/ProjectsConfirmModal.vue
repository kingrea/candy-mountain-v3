<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  description?: string
  confirmLabel?: string
  color?: 'error' | 'warning' | 'primary'
}>(), {
  description: undefined,
  confirmLabel: 'Confirm',
  color: 'error',
})

const emit = defineEmits<{
  close: [confirmed: boolean]
}>()
</script>

<template>
  <UModal
    :title="title"
    :description="description"
    :close="{ onClick: () => emit('close', false) }"
    :ui="{ footer: 'justify-end' }"
  >
    <template #footer>
      <UButton label="Cancel" color="neutral" variant="outline" @click="emit('close', false)" />
      <UButton :label="confirmLabel" :color="color" data-testid="confirm" @click="emit('close', true)" />
    </template>
  </UModal>
</template>
