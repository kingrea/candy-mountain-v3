<template>
  <UCard
    variant="outline"
    :ui="{ root: pending ? 'ring-warning/50' : undefined, header: 'px-3 py-2 sm:px-3', body: 'space-y-3 p-3 sm:p-3' }"
    data-testid="chat-decision"
    :data-decision-id="decision.id"
    :data-decision-kind="decision.kind"
    :data-state="decision.state"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon :name="decision.kind === 'permission' ? 'i-lucide-shield-question' : 'i-lucide-message-circle-question'" class="size-4 shrink-0" :class="pending ? 'text-warning' : 'text-muted'" />
        <p class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">
          {{ decision.kind === 'permission' ? 'Permission needed' : 'The agent has a question' }}
        </p>
        <UBadge
          v-if="outcome"
          :color="outcome.tone"
          variant="subtle"
          size="sm"
          data-testid="chat-decision-outcome"
        >
          {{ outcome.label }}
        </UBadge>
      </div>
    </template>

    <ChatDecisionPermission
      v-if="decision.kind === 'permission'"
      :decision="decision"
      :pending="pending"
      :submitting="submitting"
      @answer="send"
    />
    <ChatDecisionQuestion
      v-else
      :decision="decision"
      :pending="pending"
      :submitting="submitting"
      @answer="send"
    />

    <p v-if="outcome?.detail" class="text-xs whitespace-pre-wrap text-muted" data-testid="chat-decision-detail">
      {{ outcome.detail }}
    </p>
    <p v-if="error" class="text-xs text-error" data-testid="chat-decision-error">
      {{ error }}
    </p>
  </UCard>
</template>

<script setup lang="ts">
import type { AnswerDecisionRequest, Decision } from '@candy-mountain/shared'

const props = defineProps<{ decision: Decision }>()

const { slug } = useSelectedProject()
const { user } = useCurrentUser()
const decisions = useChatDecisions(slug)

const pending = computed(() => props.decision.state === 'pending')
const submitting = computed(() => Boolean(decisions.submitting.value[props.decision.id]))
const error = computed(() => (pending.value ? decisions.errors.value[props.decision.id] : undefined))
const outcome = computed(() => chatDecisionOutcome(props.decision, user.value?.id))

function send(body: AnswerDecisionRequest) {
  void decisions.answer(props.decision, body)
}
</script>
