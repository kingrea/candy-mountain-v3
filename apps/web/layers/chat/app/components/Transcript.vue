<template>
  <div ref="scroller" class="flex flex-col gap-3 overflow-y-auto px-3 py-3 *:shrink-0" data-testid="chat-transcript" @scroll.passive="onScroll">
    <p v-if="!items.length && !working" class="m-auto text-sm text-muted">
      Send a prompt to start the conversation.
    </p>
    <template v-for="(item, index) in items" :key="item.key">
      <ChatModelEffortDivider v-if="item.kind === 'divider'" :label="item.label" />
      <div
        v-else-if="item.kind === 'prompt'"
        class="max-w-[90%] self-end rounded-lg bg-primary/10 px-3 py-2 text-sm whitespace-pre-wrap text-highlighted"
        data-kind="prompt"
        :data-seq="item.seq"
      >{{ item.text }}</div>
      <ChatTranscriptMarkdown
        v-else-if="item.kind === 'text'"
        :source="item.text"
        class="min-w-0 text-default"
        data-kind="text"
        :data-seq="item.seq"
      />
      <UChatReasoning
        v-else-if="item.kind === 'reasoning'"
        :text="item.text"
        :streaming="working && index === items.length - 1"
        :duration="reasoningSeconds(item)"
        icon="i-lucide-brain"
        chevron="leading"
        data-kind="reasoning"
        :data-seq="item.seq"
      />
      <ChatTranscriptTool
        v-else-if="item.kind === 'tool'"
        :item="item"
        data-kind="tool"
        :data-seq="item.seq"
      />
      <ChatDecisionCard
        v-else-if="item.kind === 'decision'"
        :decision="item.decision"
        data-kind="decision"
        :data-seq="item.seq"
      />
      <UAlert
        v-else-if="item.kind === 'error'"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="item.title"
        :description="item.message"
        data-kind="error"
        :data-seq="item.seq"
      />
      <ChatActionCard
        v-else-if="item.kind === 'action'"
        :action="item.action"
        :state="actionState(item)"
        :tool-call-id="item.toolCallId"
        data-kind="action"
        :data-seq="item.seq"
      />
      <p
        v-else-if="item.kind === 'turn'"
        class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted"
        data-kind="turn_end"
        :data-stop-reason="item.stopReason"
        :data-seq="item.seq"
      >
        <UIcon :name="TURN_ICONS[item.stopReason] ?? 'i-lucide-circle-alert'" class="size-3.5 shrink-0" />
        <span>{{ chatStopReasonLabel(item.stopReason) }}</span>
        <span v-if="item.usage" class="text-dimmed" data-testid="chat-usage">{{ chatUsageParts(item.usage).join(' · ') }}</span>
      </p>
    </template>
    <p v-if="working" class="flex items-center gap-2 text-xs text-muted" data-testid="chat-working">
      <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
      Working
    </p>
    <p v-else-if="!connected && items.length" class="text-xs text-warning">
      Reconnecting to the session
    </p>
  </div>
</template>

<script setup lang="ts">
import type { AgentSessionEvent } from '@candy-mountain/shared'

/** The transcript boundary: rows in, rendering decided here. */
export interface ChatTranscriptProps {
  events: readonly AgentSessionEvent[]
  working: boolean
  connected?: boolean
  /** Earlier sessions of the thread, oldest first. */
  history?: readonly ChatTranscriptSession[]
  /** Shown above the current session's rows when it replaced another one. */
  divider?: string | null
  /** Whether each agent action was applied; without it every action shows as ignored. */
  actionState?: (item: ChatActionItem) => ChatActionState
}

const props = withDefaults(defineProps<ChatTranscriptProps>(), { connected: true, history: () => [], divider: null, actionState: (): ChatActionState => 'ignored' })

const TURN_ICONS: Record<string, string> = {
  end_turn: 'i-lucide-check',
  cancelled: 'i-lucide-circle-slash',
}

const items = computed(() => chatSegmentTranscript(chatTranscriptRows([...props.history, { id: CHAT_TRANSCRIPT_CURRENT, divider: props.divider, events: props.events }])))

function reasoningSeconds(item: ChatReasoningItem): number | undefined {
  if (!item.endedAt) return undefined
  const elapsed = Date.parse(item.endedAt) - Date.parse(item.at)
  return Number.isFinite(elapsed) ? Math.max(1, Math.round(elapsed / 1000)) : undefined
}

const scroller = useTemplateRef<HTMLDivElement>('scroller')
const pinned = ref(true)

function onScroll() {
  const element = scroller.value
  if (element) pinned.value = element.scrollHeight - element.scrollTop - element.clientHeight < 48
}

// Rows land in place (a tool result updates its call), so the row count, not the item count, signals new content.
const rowCount = computed(() => props.history.reduce((total, part) => total + part.events.length, props.events.length))

watch(rowCount, async () => {
  if (!pinned.value) return
  await nextTick()
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
}, { flush: 'post' })
</script>
