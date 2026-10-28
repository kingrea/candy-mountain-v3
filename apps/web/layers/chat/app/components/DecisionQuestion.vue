<template>
  <div class="space-y-3">
    <p class="text-sm whitespace-pre-wrap text-default" data-testid="chat-decision-message">
      {{ form.message }}
    </p>

    <form v-if="pending" class="space-y-3" @submit.prevent="submit">
      <UFormField
        v-for="field in form.fields"
        :key="field.key"
        :label="form.fields.length > 1 || field.title !== form.message ? field.title : undefined"
        :description="field.description && field.description !== form.message ? field.description : undefined"
        :required="field.required"
        :ui="{ description: 'whitespace-pre-wrap' }"
      >
        <template v-if="field.type === 'choice'">
          <URadioGroup
            :model-value="textOf(field.key)"
            :items="field.choices"
            label-key="label"
            value-key="value"
            description-key="description"
            size="sm"
            :data-testid="`chat-question-${field.key}`"
            @update:model-value="set(field.key, $event)"
          />
          <UInput
            v-if="field.freeText"
            :model-value="textOf(field.key)"
            placeholder="Or type your own answer"
            size="sm"
            class="mt-2 w-full"
            @update:model-value="set(field.key, $event)"
          />
        </template>
        <UCheckboxGroup
          v-else-if="field.type === 'multi'"
          :model-value="listOf(field.key)"
          :items="field.choices"
          label-key="label"
          value-key="value"
          description-key="description"
          size="sm"
          @update:model-value="set(field.key, $event)"
        />
        <USwitch
          v-else-if="field.type === 'boolean'"
          :model-value="values[field.key] === true"
          size="sm"
          @update:model-value="set(field.key, $event)"
        />
        <UInput
          v-else-if="field.type === 'number' || field.type === 'integer'"
          :model-value="textOf(field.key)"
          type="number"
          :step="field.type === 'integer' ? 1 : 'any'"
          size="sm"
          class="w-full"
          @update:model-value="set(field.key, $event)"
        />
        <UTextarea
          v-else
          :model-value="textOf(field.key)"
          :rows="1"
          autoresize
          size="sm"
          class="w-full"
          :data-testid="`chat-question-${field.key}`"
          @update:model-value="set(field.key, $event)"
        />
      </UFormField>

      <div class="flex flex-wrap gap-2">
        <UButton
          type="submit"
          label="Answer"
          icon="i-lucide-send"
          size="sm"
          :loading="submitting"
          :disabled="submitting || !complete"
          data-testid="chat-decision-answer"
        />
        <UButton
          label="Decline"
          color="neutral"
          variant="soft"
          size="sm"
          :disabled="submitting"
          data-testid="chat-decision-decline"
          @click="emit('answer', { optionKind: 'deny' })"
        />
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import type { AnswerDecisionRequest, Decision } from '@candy-mountain/shared'

const props = defineProps<{ decision: Decision, pending: boolean, submitting: boolean }>()
const emit = defineEmits<{ answer: [body: AnswerDecisionRequest] }>()

const form = computed(() => chatQuestionForm(props.decision))
const values = ref<Record<string, unknown>>({})
const answer = computed(() => chatQuestionAnswer(form.value, values.value))
const complete = computed(() => Object.keys(answer.value).length > 0 && chatQuestionComplete(form.value, answer.value))

const textOf = (key: string) => (typeof values.value[key] === 'string' || typeof values.value[key] === 'number' ? String(values.value[key]) : undefined)
const listOf = (key: string) => (Array.isArray(values.value[key]) ? values.value[key] as string[] : [])

function set(key: string, value: unknown) {
  values.value = { ...values.value, [key]: value }
}

function submit() {
  if (!complete.value || props.submitting) return
  emit('answer', { optionKind: 'answer', answer: answer.value })
}
</script>
