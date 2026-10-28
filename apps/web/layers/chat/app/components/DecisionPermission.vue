<template>
  <div class="space-y-3">
    <div class="space-y-1">
      <p class="flex items-center gap-1.5 text-sm text-default">
        <UIcon name="i-lucide-wrench" class="size-4 shrink-0 text-muted" />
        <span class="min-w-0 font-mono text-xs break-all" data-testid="chat-decision-tool">{{ tool.title }}</span>
      </p>
      <p v-for="note in tool.notes" :key="note" class="text-xs text-muted">
        {{ note }}
      </p>
      <pre v-if="input" class="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs text-default">{{ input }}</pre>
    </div>

    <template v-if="pending">
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="option in allowOnce"
          :key="option.optionId ?? 'allow'"
          :label="allowOnce.length > 1 ? option.label : 'Allow once'"
          icon="i-lucide-check"
          size="sm"
          :loading="submitting"
          :disabled="submitting"
          data-testid="chat-decision-allow-once"
          @click="choose(option)"
        />
        <UButton
          v-for="option in deny"
          :key="option.optionId ?? 'deny'"
          :label="deny.length > 1 ? option.label : 'Deny'"
          icon="i-lucide-x"
          color="error"
          variant="soft"
          size="sm"
          :disabled="submitting"
          data-testid="chat-decision-deny"
          @click="choose(option)"
        />
        <UButton
          v-if="!explaining"
          label="Deny with a reason"
          color="neutral"
          variant="link"
          size="sm"
          :disabled="submitting"
          @click="explaining = true"
        />
      </div>

      <div v-if="explaining" class="space-y-2">
        <UTextarea
          v-model="explanation"
          :rows="2"
          autoresize
          :maxlength="2000"
          placeholder="Tell the agent why, so it can try something else"
          class="w-full"
          data-testid="chat-decision-explanation"
        />
        <UButton
          label="Deny"
          color="error"
          size="sm"
          :disabled="submitting || !explanation.trim()"
          @click="choose(deny[0]!, explanation.trim())"
        />
      </div>

      <div v-if="allowAlways.length" class="space-y-2 border-t border-default pt-3" data-testid="chat-decision-always">
        <p class="text-xs text-muted">
          The agent proposed {{ allowAlways.length > 1 ? 'these rules' : 'a rule' }} so it will not ask again:
        </p>
        <ul class="space-y-2">
          <li v-for="option in allowAlways" :key="option.optionId ?? option.label" class="flex flex-wrap items-center gap-2">
            <code class="min-w-0 flex-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all">{{ chatProposedRule(option) }}</code>
            <UButton
              label="Always allow"
              icon="i-lucide-check-check"
              color="neutral"
              variant="outline"
              size="xs"
              :disabled="submitting"
              :title="option.label"
              data-testid="chat-decision-allow-always"
              @click="choose(option)"
            />
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { AnswerDecisionRequest, Decision, DecisionOption } from '@candy-mountain/shared'

const props = defineProps<{ decision: Decision, pending: boolean, submitting: boolean }>()
const emit = defineEmits<{ answer: [body: AnswerDecisionRequest] }>()

const tool = computed(() => chatDecisionTool(props.decision))
const input = computed(() => {
  const value = tool.value.input
  if (value === undefined || value === null) return ''
  if (typeof value === 'object' && Object.keys(value).length === 0) return ''
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
})
const allowOnce = computed(() => chatDecisionOptions(props.decision, 'allow_once'))
const allowAlways = computed(() => chatDecisionOptions(props.decision, 'allow_always'))
const deny = computed(() => chatDecisionOptions(props.decision, 'deny'))

const explaining = ref(false)
const explanation = ref('')

function choose(option: DecisionOption, reason?: string) {
  emit('answer', {
    optionKind: option.kind,
    ...(option.optionId ? { optionId: option.optionId } : {}),
    ...(reason ? { explanation: reason } : {}),
  })
}
</script>
