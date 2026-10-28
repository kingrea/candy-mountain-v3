<script setup lang="ts">
import { NOTIFICATION_KIND_LABELS, type NotificationKind, type NotificationRule } from '@candy-mountain/shared'

const props = defineProps<{
  kind: NotificationKind
  rule: NotificationRule
  saving: boolean
  disabled: boolean
  /** Message from the daemon for the last save attempt. */
  serverError?: string
}>()

const emit = defineEmits<{ save: [draft: RuleDraft] }>()

const draft = reactive<RuleDraft>(ruleToDraft(props.rule))
const touched = ref(false)

watch(() => props.rule, (rule) => {
  Object.assign(draft, ruleToDraft(rule))
  touched.value = false
})

const typeItems = Object.entries(DESTINATION_HINTS).map(([value, hint]) => ({ value, label: hint.label }))
const hint = computed(() => DESTINATION_HINTS[draft.type])
const error = computed(() => (touched.value ? draftError(draft) : null) ?? props.serverError ?? null)
const dirty = computed(() => draftChanged(draft, props.rule))

function onSave() {
  touched.value = true
  if (draftError(draft)) return
  emit('save', { ...draft })
}
</script>

<template>
  <UCard :data-testid="`notification-${kind}`" :data-enabled="rule.enabled">
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="font-semibold text-highlighted">
          {{ NOTIFICATION_KIND_LABELS[kind] }}
        </h2>
        <USwitch
          v-model="draft.enabled"
          :disabled="disabled"
          :aria-label="`Send a notification when ${NOTIFICATION_KIND_LABELS[kind].toLowerCase()}`"
          data-testid="notification-toggle"
        />
      </div>

      <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
        <URadioGroup
          v-model="draft.type"
          :items="typeItems"
          :disabled="disabled"
          orientation="horizontal"
          size="sm"
          data-testid="notification-type"
        />
        <UFormField :error="error ?? undefined" :help="error ? undefined : hint.help" class="min-w-0 flex-1">
          <UInput
            v-model="draft.id"
            :placeholder="hint.placeholder"
            :disabled="disabled"
            :aria-label="`${hint.label} ID`"
            class="w-full"
            data-testid="notification-id"
            @update:model-value="touched = false"
            @blur="touched = true"
          />
        </UFormField>
        <UButton
          label="Save"
          :loading="saving"
          :disabled="disabled || !dirty"
          data-testid="notification-save"
          @click="onSave"
        />
      </div>

      <UAlert
        v-if="rule.lastFailureAt"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        data-testid="notification-failure"
        :title="`Last delivery failed ${new Date(rule.lastFailureAt).toLocaleString()}`"
        :description="rule.lastFailureReason ?? undefined"
      />
      <p v-else-if="rule.lastDeliveredAt" class="text-xs text-muted">
        Last delivered {{ new Date(rule.lastDeliveredAt).toLocaleString() }}
      </p>
    </div>
  </UCard>
</template>
