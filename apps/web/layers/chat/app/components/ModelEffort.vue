<template>
  <div class="flex items-center gap-1" data-testid="chat-model-effort">
    <USelect
      v-if="options.models.length"
      :model-value="chatOptionValue(model)"
      :items="modelItems"
      :disabled="disabled"
      icon="i-lucide-cpu"
      variant="ghost"
      size="xs"
      aria-label="Model"
      data-testid="chat-model-select"
      :content="{ side: 'top' }"
      class="min-w-0"
      @update:model-value="value => change({ model: chatOptionChoice(String(value)), effort })"
    />
    <USelect
      v-if="options.efforts.length"
      :model-value="chatOptionValue(effort)"
      :items="effortItems"
      :disabled="disabled"
      icon="i-lucide-gauge"
      variant="ghost"
      size="xs"
      aria-label="Effort"
      data-testid="chat-effort-select"
      :content="{ side: 'top' }"
      class="min-w-0"
      @update:model-value="value => change({ model, effort: chatOptionChoice(String(value)) })"
    />
  </div>
</template>

<script setup lang="ts">
import type { ChatAgentOptions } from '@candy-mountain/shared'

const props = defineProps<{
  options: ChatAgentOptions
  model: string | null
  effort: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{ change: [choice: ChatModelEffortChoice] }>()

const modelItems = computed(() => chatOptionItems(props.options.models, 'Default model'))
const effortItems = computed(() => chatOptionItems(props.options.efforts, 'Default effort'))

function change(choice: ChatModelEffortChoice) {
  if (choice.model !== props.model || choice.effort !== props.effort) emit('change', choice)
}
</script>
