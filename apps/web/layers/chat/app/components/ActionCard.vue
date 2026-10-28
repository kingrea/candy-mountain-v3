<template>
  <div
    class="flex items-center gap-2 rounded-md border border-default bg-elevated/50 px-3 py-2 text-sm"
    data-testid="chat-action"
    :data-state="state"
    :data-action-kind="action.kind"
    :data-tool-call-id="toolCallId"
  >
    <UIcon :name="action.kind === 'navigate' ? 'i-lucide-compass' : 'i-lucide-message-square-plus'" class="size-4 shrink-0" :class="state === 'ignored' ? 'text-dimmed' : 'text-primary'" />
    <p class="min-w-0 flex-1 truncate" :class="state === 'ignored' ? 'text-muted' : 'text-highlighted'" data-testid="chat-action-label">
      {{ label }}
    </p>
    <UIcon v-if="state === 'applying'" name="i-lucide-loader-circle" class="size-3.5 shrink-0 animate-spin text-muted" />
    <UTooltip v-else-if="badge" :text="badge.hint" :disabled="!badge.hint">
      <UBadge :color="badge.color" variant="subtle" size="sm" data-testid="chat-action-state">
        {{ badge.label }}
      </UBadge>
    </UTooltip>
  </div>
</template>

<script setup lang="ts">
import type { PlatformClientAction } from '@candy-mountain/shared'

const props = defineProps<{ action: PlatformClientAction, state: ChatActionState, toolCallId: string }>()

const { registry } = useProjectRegistry()

const label = computed(() => chatActionLabel(props.action, props.state, registry.value))

const BADGES: Partial<Record<ChatActionState, { label: string, color: 'success' | 'error' | 'neutral', hint?: string }>> = {
  applied: { label: 'Applied', color: 'success' },
  failed: { label: 'Failed', color: 'error' },
  ignored: { label: 'Ignored', color: 'neutral', hint: 'Only the platform agent can steer the app.' },
}

const badge = computed(() => BADGES[props.state])
</script>
