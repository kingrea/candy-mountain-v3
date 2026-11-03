<template>
  <UChatPrompt
    v-model="text"
    :placeholder="working ? 'Waiting for the agent' : 'Send a prompt'"
    :error="errorValue"
    :rows="1"
    :maxrows="8"
    autoresize
    data-testid="chat-prompt"
    @submit="submit"
  >
    <UChatPromptSubmit
      :status="working ? 'streaming' : 'ready'"
      data-testid="chat-prompt-submit"
      @stop="emit('cancel')"
    />

    <template #footer>
      <slot name="options" />
    </template>
  </UChatPrompt>
</template>

<script setup lang="ts">
const props = defineProps<{
  working: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  send: [text: string]
  cancel: []
}>()

const text = ref('')
const errorValue = computed(() => (props.error ? new Error(props.error) : undefined))

function submit() {
  const value = text.value.trim()
  if (!value || props.working) return
  emit('send', value)
  text.value = ''
}
</script>
