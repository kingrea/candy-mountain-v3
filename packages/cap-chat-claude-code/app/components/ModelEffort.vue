<template>
  <div v-if="options && available" class="flex items-center gap-1" data-testid="chat-model-effort">
    <USelect
      v-if="options.models.length"
      :model-value="chatClaudeCodeOptionValue(choice.model)"
      :items="modelItems"
      :disabled="disabled"
      icon="i-lucide-cpu"
      variant="ghost"
      size="xs"
      aria-label="Model"
      data-testid="chat-model-select"
      :content="{ side: 'top' }"
      class="min-w-0"
      @update:model-value="value => change({ model: chatClaudeCodeOptionChoice(String(value)), effort: choice.effort })"
    />
    <USelect
      v-if="options.efforts.length"
      :model-value="chatClaudeCodeOptionValue(choice.effort)"
      :items="effortItems"
      :disabled="disabled"
      icon="i-lucide-gauge"
      variant="ghost"
      size="xs"
      aria-label="Effort"
      data-testid="chat-effort-select"
      :content="{ side: 'top' }"
      class="min-w-0"
      @update:model-value="value => change({ model: choice.model, effort: chatClaudeCodeOptionChoice(String(value)) })"
    />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ thread: ChatFamilyThread }>()

const toast = useToast()
const { options, available } = useChatClaudeCodeOptions(() => props.thread.slug.value, () => props.thread.agentId.value)

const modelItems = computed(() => chatClaudeCodeOptionItems(options.value?.models ?? [], 'Default model'))
const effortItems = computed(() => chatClaudeCodeOptionItems(options.value?.efforts ?? [], 'Default effort'))

const changing = ref(false)
const disabled = computed(() => props.thread.working.value || changing.value)
const choice = computed<ChatClaudeCodeModelEffortChoice>(() => {
  const thread = props.thread.thread.value
  if (props.thread.threadId.value && thread) return { model: thread.model, effort: thread.effort }
  return { model: props.thread.draft.value.model ?? null, effort: props.thread.draft.value.effort ?? null }
})

// Each session boundary in the transcript says what changed to start it.
watchEffect(() => {
  props.thread.setSessionDividers(chatClaudeCodeSessionDividers(props.thread.sessions.value, options.value))
})

async function change(next: ChatClaudeCodeModelEffortChoice) {
  if (next.model === choice.value.model && next.effort === choice.value.effort) return
  if (!props.thread.threadId.value) {
    props.thread.setDraft({ ...props.thread.draft.value, ...next })
    return
  }
  changing.value = true
  try {
    await props.thread.update(next)
  }
  catch (cause) {
    const failure = toApiError(cause)
    const busy = failure.code === 'thread_busy'
    toast.add({
      title: busy ? 'The agent is still working' : 'Model or effort not changed',
      description: busy ? 'Wait for the turn to end or stop it, then change the model or effort.' : failure.message,
      color: busy ? 'warning' : 'error',
      icon: 'i-lucide-circle-alert',
    })
  }
  finally {
    changing.value = false
  }
}
</script>
