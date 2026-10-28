<script setup lang="ts">
import type { IssuesAgentCreateOption } from '#layers/issues/app/utils/issue-create'

defineProps<{
  agentOptions: IssuesAgentCreateOption[]
}>()

const emit = defineEmits<{
  agent: [option: IssuesAgentCreateOption]
  write: []
}>()
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="issue-add-chooser">
    <UButton
      v-for="option in agentOptions"
      :key="option.capabilityId"
      color="neutral"
      variant="outline"
      size="lg"
      block
      :icon="option.icon"
      :label="option.label"
      class="justify-start"
      :data-testid="`issue-add-${option.agentId}`"
      @click="emit('agent', option)"
    />
    <UButton
      color="neutral"
      variant="outline"
      size="lg"
      block
      icon="i-lucide-pencil-line"
      label="Write yourself"
      class="justify-start"
      data-testid="issue-add-write"
      @click="emit('write')"
    />
  </div>
</template>
