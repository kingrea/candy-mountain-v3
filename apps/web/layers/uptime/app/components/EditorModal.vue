<script setup lang="ts">
import {
  MONITOR_INTERVAL_MAX_SECONDS,
  MONITOR_INTERVAL_MIN_SECONDS,
  MONITOR_NAME_MAX_LENGTH,
  MONITOR_TARGET_MAX_LENGTH,
  projectMonitorPath,
  projectMonitorsPath,
  type Monitor,
  type MonitorResponse,
  type MonitorSourceInfo,
} from '@candy-mountain/shared'
import type { FormError } from '@nuxt/ui'

const props = defineProps<{
  /** Null to create a new monitor. */
  monitor: Monitor | null
  sources: MonitorSourceInfo[]
}>()

const emit = defineEmits<{
  saved: [monitor: Monitor, created: boolean]
}>()

const open = defineModel<boolean>('open', { required: true })

const { $api } = useNuxtApp()
const { slug } = useSelectedProject()

const state = reactive<UptimeMonitorDraft>(uptimeMonitorDraft(null, []))
const saving = ref(false)
const formError = ref<ApiErrorInfo | null>(null)

const isEdit = computed(() => props.monitor !== null)
const typeItems = computed(() => props.sources.map(source => ({ label: source.label, value: source.id })))
const source = computed(() => props.sources.find(candidate => candidate.id === state.sourceType) ?? null)
const fields = computed(() => source.value?.fields ?? [])

function reset() {
  Object.assign(state, uptimeMonitorDraft(props.monitor, props.sources))
  formError.value = null
}

watch(open, (isOpen) => {
  if (isOpen) reset()
  else saving.value = false
}, { immediate: true })

watch(() => props.sources, () => {
  if (!state.sourceType) reset()
})

function onTypeChange(sourceType: string) {
  const fieldsOf = props.sources.find(candidate => candidate.id === sourceType)?.fields ?? []
  const stored = props.monitor?.sourceType === sourceType ? props.monitor.options : undefined
  state.options = uptimeOptionsDraft(fieldsOf, stored)
}

const validate = (): FormError[] => uptimeFormErrors(props.sources, state)

async function onSubmit() {
  if (!slug.value) return
  formError.value = null
  saving.value = true
  const monitor = props.monitor
  try {
    const response = monitor
      ? await $api<MonitorResponse>(projectMonitorPath(slug.value, monitor.id), { method: 'PATCH', body: uptimeUpdateBody(monitor, fields.value, state) })
      : await $api<MonitorResponse>(projectMonitorsPath(slug.value), { method: 'POST', body: uptimeCreateBody(fields.value, state) })
    emit('saved', response.monitor, !monitor)
    open.value = false
  }
  catch (error) {
    formError.value = toApiError(error)
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="isEdit ? `Edit ${monitor?.name}` : 'New monitor'"
    description="What to check, and how often."
    :ui="{ footer: 'justify-end', content: 'sm:max-w-xl' }"
  >
    <template #body>
      <UForm
        id="monitor-form"
        :state="state"
        :validate="validate"
        :validate-on="['change', 'blur']"
        class="flex flex-col gap-4"
        data-testid="monitor-form"
        @submit="onSubmit"
      >
        <UAlert
          v-if="formError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="formError.message"
          data-testid="form-error"
        />

        <UFormField name="name" label="Name" required>
          <UInput v-model="state.name" class="w-full" placeholder="Website" :maxlength="MONITOR_NAME_MAX_LENGTH" data-testid="monitor-name" />
        </UFormField>

        <UFormField name="sourceType" label="Type" :description="source?.description" required>
          <USelect
            v-model="state.sourceType"
            :items="typeItems"
            placeholder="Choose a type"
            class="w-full"
            data-testid="monitor-type-select"
            @update:model-value="onTypeChange"
          />
        </UFormField>

        <UFormField name="target" :label="source?.targetLabel ?? 'Target URL'" required>
          <UInput
            v-model="state.target"
            type="url"
            class="w-full"
            :placeholder="source?.targetPlaceholder ?? 'https://'"
            :maxlength="MONITOR_TARGET_MAX_LENGTH"
            data-testid="monitor-target"
          />
        </UFormField>

        <UFormField
          name="intervalSeconds"
          label="Check every (seconds)"
          :description="`From ${MONITOR_INTERVAL_MIN_SECONDS} to ${MONITOR_INTERVAL_MAX_SECONDS}.`"
          required
        >
          <UInputNumber
            v-model="state.intervalSeconds"
            :min="MONITOR_INTERVAL_MIN_SECONDS"
            :max="MONITOR_INTERVAL_MAX_SECONDS"
            :step="30"
            class="w-full"
            data-testid="monitor-interval"
          />
        </UFormField>

        <UFormField
          v-for="field in fields"
          :key="field.name"
          :name="`options.${field.name}`"
          :label="field.label"
          :description="field.description"
          :required="field.required && field.default === undefined"
        >
          <UInput
            v-model="state.options[field.name]"
            class="w-full"
            :placeholder="field.placeholder ?? (field.default === undefined ? undefined : String(field.default))"
            :inputmode="field.kind === 'integer' ? 'numeric' : undefined"
            :maxlength="field.kind === 'string' ? field.maxLength : undefined"
            :data-field="field.name"
          />
        </UFormField>
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton label="Cancel" color="neutral" variant="outline" @click="close" />
      <UButton
        type="submit"
        form="monitor-form"
        :label="isEdit ? 'Save' : 'Add monitor'"
        :loading="saving"
        data-testid="monitor-submit"
      />
    </template>
  </UModal>
</template>
