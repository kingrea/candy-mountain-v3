<script setup lang="ts">
const { registry } = useProjectRegistry()

// The overview is open to everyone; only ask when this actor can see the notes.
const visible = computed(() => !!registry.value && resolveViewAccess(registry.value, 'template', 'template').state === 'ready')
const { notes } = useTemplateNotes(() => visible.value)
</script>

<template>
  <UCard v-if="notes.length" data-testid="template-card">
    <template #header>
      <h2 class="font-semibold text-highlighted">
        Template
      </h2>
    </template>
    <p class="text-sm text-toned">
      {{ notes.length === 1 ? '1 note' : `${notes.length} notes` }}
    </p>
  </UCard>
</template>
