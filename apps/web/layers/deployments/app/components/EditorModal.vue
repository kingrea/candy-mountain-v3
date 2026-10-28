<script setup lang="ts">
import {
  ENVIRONMENT_NAME_MAX_LENGTH,
  projectEnvironmentPath,
  projectEnvironmentsPath,
  type Environment,
  type EnvironmentResponse,
  type LiveVersionSourceInfo,
} from '@candy-mountain/shared'
import type { FormError } from '@nuxt/ui'

const props = defineProps<{
  /** Null to create a new environment. */
  environment: Environment | null
  sources: LiveVersionSourceInfo[]
}>()

const emit = defineEmits<{
  saved: [environment: Environment, created: boolean]
}>()

const open = defineModel<boolean>('open', { required: true })

const { $api } = useNuxtApp()
const { slug } = useSelectedProject()
const plugins = usePlugins()
const form = useTemplateRef('form')

const state = reactive<DeploymentsEnvironmentDraft>({ name: '', kind: '', settings: {} })
const saving = ref(false)
const formError = ref<ApiErrorInfo | null>(null)

const isEdit = computed(() => props.environment !== null)
const pluginInstances = computed(() => [...plugins.projectInstances.value, ...plugins.globalInstances.value])
const choices = computed(() => deploymentsSourceChoices(props.sources, pluginInstances.value, props.environment?.liveSourceKind))
const kindItems = computed(() => choices.value.available.map(source => ({ label: source.label, value: source.id })))
const source = computed(() => props.sources.find(candidate => candidate.id === state.kind) ?? null)
const fields = computed(() => source.value?.fields ?? [])
const hiddenLabels = computed(() => choices.value.hidden.map(hidden => hidden.label).join(' and '))

function settingsFor(kind: string) {
  const fieldsOf = props.sources.find(candidate => candidate.id === kind)?.fields ?? []
  const stored = props.environment?.liveSourceKind === kind ? props.environment.liveSourceSettings : undefined
  return deploymentsSettingsDraft(fieldsOf, stored)
}

function reset() {
  state.name = props.environment?.name ?? ''
  state.kind = props.environment?.liveSourceKind ?? choices.value.available[0]?.id ?? ''
  state.settings = settingsFor(state.kind)
  formError.value = null
}

watch(open, (isOpen) => {
  if (isOpen) reset()
  else saving.value = false
}, { immediate: true })

watch(() => props.sources, () => {
  if (!state.kind) reset()
})

function onKindChange(kind: string) {
  state.settings = settingsFor(kind)
}

function validate(): FormError[] {
  const errors: FormError[] = []
  const name = state.name.trim()
  if (!name) errors.push({ name: 'name', message: 'Name is required' })
  else if (name.length > ENVIRONMENT_NAME_MAX_LENGTH) errors.push({ name: 'name', message: `At most ${ENVIRONMENT_NAME_MAX_LENGTH} characters` })
  if (!state.kind) errors.push({ name: 'kind', message: 'Choose where the live version comes from' })
  for (const error of deploymentsSettingsErrors(fields.value, state.settings)) {
    errors.push({ name: error.field ? `settings.${error.field}` : 'kind', message: error.message })
  }
  return errors
}

async function onSubmit() {
  if (!slug.value) return
  formError.value = null
  saving.value = true
  const environment = props.environment
  try {
    const response = environment
      ? await $api<EnvironmentResponse>(projectEnvironmentPath(slug.value, environment.id), { method: 'PATCH', body: deploymentsUpdateBody(environment, fields.value, state) })
      : await $api<EnvironmentResponse>(projectEnvironmentsPath(slug.value), { method: 'POST', body: deploymentsCreateBody(fields.value, state) })
    emit('saved', response.environment, !environment)
    open.value = false
  }
  catch (error) {
    const apiError = toApiError(error)
    if (apiError.code === 'name_taken') form.value?.setErrors([{ name: 'name', message: apiError.message }])
    else formError.value = apiError
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="isEdit ? `Edit ${environment?.name}` : 'New environment'"
    description="Where this environment's live version is read from."
    :ui="{ footer: 'justify-end', content: 'sm:max-w-xl' }"
  >
    <template #body>
      <UForm
        id="environment-form"
        ref="form"
        :state="state"
        :validate="validate"
        :validate-on="['change', 'blur']"
        class="flex flex-col gap-4"
        data-testid="environment-form"
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
          <UInput v-model="state.name" class="w-full" placeholder="Production" :maxlength="ENVIRONMENT_NAME_MAX_LENGTH" data-testid="environment-name" />
        </UFormField>

        <UFormField name="kind" label="Live version from" :description="source?.description" required>
          <USelect
            v-model="state.kind"
            :items="kindItems"
            placeholder="Choose a source"
            class="w-full"
            data-testid="environment-kind"
            @update:model-value="onKindChange"
          />
          <template v-if="hiddenLabels && slug" #help>
            <span data-testid="hidden-kinds">
              {{ hiddenLabels }} appear here once that plugin is set up and healthy on the
              <ULink :to="projectPluginsPagePath(slug)" class="text-primary">Plugins page</ULink>.
            </span>
          </template>
        </UFormField>

        <template v-if="source">
          <UFormField
            v-for="field in fields"
            :key="field.name"
            :name="`settings.${field.name}`"
            :label="field.label"
            :description="field.description"
            :required="field.required && field.default === undefined"
          >
            <UInput
              v-model="state.settings[field.name]"
              class="w-full"
              :placeholder="field.placeholder"
              :inputmode="field.kind === 'integer' ? 'numeric' : undefined"
              :data-field="field.name"
            />
          </UFormField>
          <p v-if="!fields.length" class="text-sm text-muted" data-testid="no-settings">
            Nothing to set here: it reads from the project's {{ source.label }} plugin.
          </p>
        </template>
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton label="Cancel" color="neutral" variant="outline" @click="close" />
      <UButton
        type="submit"
        form="environment-form"
        :label="isEdit ? 'Save' : 'Add environment'"
        :loading="saving"
        data-testid="environment-submit"
      />
    </template>
  </UModal>
</template>
