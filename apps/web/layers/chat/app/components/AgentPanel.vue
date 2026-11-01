<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <header class="flex h-(--ui-header-height) shrink-0 items-center gap-2 border-b border-default px-3">
      <UButton
        v-if="inThread"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Back to threads"
        data-testid="chat-panel-back"
        @click="showList()"
      />
      <UIcon v-else :name="entry.avatar" class="size-5 shrink-0 text-primary" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-semibold text-highlighted" data-testid="chat-panel-title">
          {{ inThread ? threadTitle : entry.label }}
        </p>
        <p v-if="inThread" class="truncate text-xs text-muted">
          {{ entry.label }}
        </p>
      </div>
      <UButton
        v-if="!inThread"
        icon="i-lucide-plus"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="New thread"
        data-testid="chat-panel-new"
        @click="startThread(entry.id)"
      />
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Close chat"
        data-testid="chat-panel-close"
        @click="close()"
      />
    </header>

    <template v-if="inThread">
      <component :is="piece" v-for="(piece, index) in aboveTranscript" :key="index" :thread="familyThread" />
      <ChatTranscript
        :events="session.events.value"
        :working="working"
        :connected="session.connected.value"
        :history="history"
        :divider="currentDivider"
        :action-state="actions.stateOf"
        class="min-h-0 flex-1"
      />
      <ChatPromptBar
        :working="working"
        :error="error"
        class="shrink-0 border-t border-default p-3"
        @send="send"
        @cancel="cancel"
      >
        <template v-if="promptBar.length" #options>
          <component :is="piece" v-for="(piece, index) in promptBar" :key="index" :thread="familyThread" />
        </template>
      </ChatPromptBar>
    </template>

    <ChatThreadList
      v-else
      :threads="threads"
      :status="status"
      class="min-h-0 flex-1"
      @select="id => showThread(entry.id, id)"
      @create="startThread(entry.id)"
    />
  </div>
</template>

<script setup lang="ts">
import type { UpdateChatThreadRequest } from '@candy-mountain/shared'

const props = defineProps<{ entry: ChatRailEntry }>()

const { slug } = useSelectedProject()
const { registry } = useProjectRegistry()
const { state, showThread, showList, startThread, close } = useChatPanel()
const toast = useToast()

const agentId = computed(() => props.entry.agentId ?? props.entry.id)
const agent = computed(() => registry.value?.agents.find(candidate => candidate.id === agentId.value) ?? null)
const threadId = computed(() => state.value.threadId)
const inThread = computed(() => state.value.draft || threadId.value !== null)

const list = useChatThreads(slug, agentId)
const { threads, status } = list
const current = useChatThread(slug, threadId)
const session = useChatSession(slug, () => current.session.value?.id)
const actions = useChatClientActions(() => current.thread.value?.agentId, current.session, session.events)

const earlier = computed(() => current.sessions.value.filter(entry => entry.sessionId !== current.session.value?.id))
const sessionHistory = useChatSessionHistory(slug, () => earlier.value.map(entry => entry.sessionId))

const listed = computed(() => threads.value.find(thread => thread.id === threadId.value) ?? null)
const threadTitle = computed(() => listed.value?.title ?? current.thread.value?.title ?? 'New thread')
// The stream's status is the live truth once it arrives; the list's flag covers the moment before.
const working = computed(() => session.status.value ? session.working.value : (listed.value?.working ?? false))
const error = ref<string | null>(null)

// The family's pieces own what a thread of theirs is created with and what a change of session means.
const aboveTranscript = computed(() => chatFamilyComponents(agent.value?.family, 'aboveTranscript'))
const promptBar = computed(() => chatFamilyComponents(agent.value?.family, 'promptBar'))
const draft = ref<ChatFamilyDraft>({})
const sessionDividers = ref<Record<string, string>>({})
const familyThread: ChatFamilyThread = {
  slug,
  agentId,
  agent,
  threadId,
  thread: computed(() => listed.value ?? current.thread.value),
  sessions: current.sessions,
  working,
  draft,
  setDraft: (fields) => {
    draft.value = fields
  },
  setSessionDividers: (labels) => {
    sessionDividers.value = labels
  },
  update,
  refresh: async () => {
    await Promise.all([current.refresh(), list.refresh()])
  },
}

const currentDivider = computed(() => (current.session.value ? sessionDividers.value[current.session.value.id] ?? null : null))
const history = computed<ChatTranscriptSession[]>(() => earlier.value.map(entry => ({
  id: entry.sessionId,
  divider: sessionDividers.value[entry.sessionId] ?? null,
  events: sessionHistory.logs.value[entry.sessionId] ?? [],
})))

watch([threadId, agentId], () => {
  draft.value = {}
  sessionDividers.value = {}
})

async function update(body: UpdateChatThreadRequest) {
  const id = threadId.value
  if (!id) throw new Error('The thread is still a draft')
  const replaced = current.session.value?.id
  await list.update(id, body)
  // The stream resets on the new session id; keep the log already on screen instead of fetching it again.
  if (replaced) sessionHistory.remember(replaced, session.events.value)
  await current.refresh()
}

async function send(text: string) {
  error.value = null
  try {
    let id = threadId.value
    if (!id) {
      const created = await list.create({ agentId: agentId.value, ...draft.value })
      id = created.thread.id
      actions.follow(created.session)
      showThread(props.entry.id, id)
    }
    const sent = await list.prompt(id, text)
    // A prompt may restart the thread on a fresh session; follow it like a session change.
    const replaced = current.session.value?.id
    if (replaced && sent.session.id !== replaced) {
      sessionHistory.remember(replaced, session.events.value)
      await current.refresh()
    }
  }
  catch (cause) {
    const failure = toApiError(cause)
    error.value = failure.message
    toast.add({ title: 'Prompt not sent', description: failure.message, color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

async function cancel() {
  if (!threadId.value) return
  try {
    await list.cancel(threadId.value)
  }
  catch (cause) {
    toast.add({ title: 'Cancel failed', description: toApiError(cause).message, color: 'error', icon: 'i-lucide-circle-alert' })
  }
}

// A shown thread is read: on open, and again when a turn ending flips it back to unread.
watch(() => [threadId.value, listed.value?.unread] as const, ([id, unread]) => {
  if (id && unread) void list.markRead(id).catch(() => undefined)
}, { immediate: true })

// The list's flags lag the stream; a turn ending is when they change.
watch(session.working, (now, before) => {
  if (before && !now) void list.refresh()
})
</script>
