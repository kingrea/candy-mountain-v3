<template>
  <aside
    v-if="open && entry"
    aria-label="Chat panel"
    data-testid="chat-panel"
    class="fixed inset-0 z-40 flex flex-col bg-default md:static md:z-auto md:w-[26rem] md:shrink-0 md:border-l md:border-default"
  >
    <component :is="entry.panel" v-if="entry.panel" :entry="entry" />
    <ChatAgentPanel v-else :entry="entry" />
  </aside>
</template>

<script setup lang="ts">
const props = defineProps<{ entries: ChatRailEntry[] }>()
const { state, open, close } = useChatPanel()

// A deep-linked thread can arrive before the registry lists its agent; the panel need not wait for the rail.
const entry = computed<ChatRailEntry | null>(() => {
  const id = state.value.entryId
  if (!id) return null
  return props.entries.find(candidate => candidate.id === id) ?? { id, label: id, avatar: CHAT_DEFAULT_AVATAR, agentId: id }
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) close()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  onScopeDispose(() => window.removeEventListener('keydown', onKeydown))
})
</script>
