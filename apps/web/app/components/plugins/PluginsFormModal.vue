<script setup lang="ts">
import type { PluginInstance, PluginScope, PluginTypeInfo } from '@candy-mountain/shared'
import type { FormError } from '@nuxt/ui'

const props = defineProps<{
  type: PluginTypeInfo | null
  /** Null to create a new instance of `type`. */
  instance: PluginInstance | null
  /** Scopes a new instance may take; ignored when editing. */
  scopes: PluginScope[]
}>()

const emit = defineEmits<{
  saved: [instance: PluginInstance, created: boolean]
}>()

const open = defineModel<boolean>('open', { required: true })

const { project, slug } = useSelectedProject()
const { createPlugin, updatePlugin } = usePluginActions()

const state = reactive<{
  scope: PluginScope | undefined
  config: PluginConfigDraft
  secrets: Record<string, PluginSecretDraft>
}>({ scope: undefined, config: { text: {}, choice: {}, flag: {} }, secrets: {} })
const saving = ref(false)
const formError = ref<ApiErrorInfo | null>(null)

const isEdit = computed(() => props.instance !== null)
const configFields = computed(() => props.type?.configFields ?? [])
const secretFields = computed(() => props.type?.secretFields ?? [])
/** A type-specific setup form takes over the right-hand column, including its own submit actions. */
const customForm = computed(() => (props.type ? pluginFormFor(props.type.id) : undefined))

const thisScope = `this ${SCOPE.singular}`

const scopeItems = computed(() => props.scopes.map(scope => ({
  value: scope,
  label: PLUGIN_SCOPE_LABELS[scope],
  description: scope === 'project' ? `Used by ${project.value?.name ?? thisScope} only.` : `Shared by every ${SCOPE.singular} that has no plugin of its own.`,
})))
const scopeText = computed(() => (state.scope === 'project' ? `Used by ${project.value?.name ?? thisScope} only.` : `Platform-wide: shared by every ${SCOPE.singular} that has no plugin of its own.`))

function reset() {
  const type = props.type
  state.scope = props.instance?.scope ?? props.scopes[0]
  state.config = pluginConfigDraft(type?.configFields ?? [], props.instance?.config)
  state.secrets = pluginSecretDrafts(type?.secretFields ?? [], props.instance?.secrets)
  formError.value = null
}

watch(open, (isOpen) => {
  // Typed secret values are dropped on close so they never outlive the dialog.
  reset()
  if (!isOpen) saving.value = false
}, { immediate: true })

function selectItems(field: Extract<PluginTypeInfo['configFields'][number], { kind: 'select' }>) {
  const items = field.options.map(option => ({ label: option.label, value: option.value }))
  return field.required || field.default !== undefined ? items : [{ label: 'Not set', value: PLUGIN_SELECT_NONE }, ...items]
}

function secretDraft(name: string): PluginSecretDraft {
  return state.secrets[name] ?? { mode: 'replace', value: '' }
}

function validate(): FormError[] {
  const type = props.type
  if (!type) return []
  return [
    ...pluginConfigErrors(type.configFields, state.config).map(error => ({ name: `config.${error.field}`, message: error.message })),
    ...pluginSecretErrors(type.secretFields, state.secrets, props.instance?.secrets).map(error => ({ name: `secrets.${error.field}`, message: error.message })),
  ]
}

function onCustomSaved(instance: PluginInstance, created: boolean) {
  emit('saved', instance, created)
  open.value = false
}

async function onSubmit() {
  const type = props.type
  if (!type) return
  formError.value = null
  saving.value = true
  try {
    const secrets = pluginSecretsPayload(type.secretFields, state.secrets)
    const saved = props.instance
      ? await updatePlugin(props.instance.id, { config: pluginConfigPayload(type.configFields, state.config, true), secrets })
      : await createPlugin({
          type: type.id,
          scope: state.scope ?? type.scopes[0]!,
          project: state.scope === 'project' ? slug.value : null,
          config: pluginConfigPayload(type.configFields, state.config),
          secrets,
        })
    emit('saved', saved, !props.instance)
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
    :title="isEdit ? 'Edit plugin' : 'Add plugin'"
    :ui="{ content: 'sm:max-w-3xl', footer: 'justify-end' }"
  >
    <template #body>
      <div v-if="type" class="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" data-testid="plugin-form-layout">
        <aside class="flex flex-col gap-4 md:border-r md:border-default md:pr-6" data-testid="plugin-info">
          <div class="flex items-start gap-3">
            <PluginsIcon :type="type.id" class="mt-0.5" />
            <div class="min-w-0">
              <p class="font-medium text-highlighted">
                {{ type.name }}
              </p>
              <p class="mt-0.5 text-sm text-muted">
                {{ type.description }}
              </p>
            </div>
          </div>

          <PluginsReach v-if="!isEdit" :reach="type.reach" />

          <UFormField v-if="!isEdit && scopes.length > 1" name="scope" label="Used by">
            <URadioGroup v-model="state.scope" :items="scopeItems" />
          </UFormField>
          <div v-else-if="state.scope" data-testid="plugin-scope">
            <p class="text-xs font-medium text-toned">
              Used by
            </p>
            <p class="mt-1 text-sm text-default">
              {{ scopeText }}
            </p>
          </div>
        </aside>

        <div class="min-w-0">
          <component
            :is="customForm"
            v-if="customForm && state.scope"
            :type="type"
            :instance="instance"
            :scope="state.scope"
            @saved="onCustomSaved"
            @close="open = false"
          />

          <UForm
            v-else
            id="plugin-form"
            :state="state"
            :validate="validate"
            :validate-on="['change', 'blur']"
            class="flex flex-col gap-4"
            data-testid="plugin-form"
            @submit="onSubmit"
          >
            <UAlert
              v-if="formError"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
              :title="formError.message"
              :description="formError.code"
              data-testid="form-error"
            />

            <UFormField
              v-for="field in configFields"
              :key="field.name"
              :name="`config.${field.name}`"
              :label="field.kind === 'boolean' ? undefined : field.label"
              :description="field.description"
              :required="field.required && field.default === undefined"
            >
              <UInput
                v-if="field.kind === 'string'"
                v-model="state.config.text[field.name]"
                class="w-full"
                :placeholder="field.placeholder"
                :data-field="field.name"
              />
              <USelect
                v-else-if="field.kind === 'select'"
                v-model="state.config.choice[field.name]"
                :items="selectItems(field)"
                :placeholder="`Choose ${field.label.toLowerCase()}`"
                class="w-full"
                :data-field="field.name"
              />
              <USwitch
                v-else
                v-model="state.config.flag[field.name]"
                :label="field.label"
                :data-field="field.name"
              />
            </UFormField>

            <template v-if="secretFields.length">
              <USeparator label="Secrets" />
              <p class="-mt-2 text-xs text-muted">
                Stored encrypted on the daemon. Saved values are never shown again, only whether they are set.
              </p>
              <UFormField
                v-for="field in secretFields"
                :key="field.name"
                :name="`secrets.${field.name}`"
                :label="field.label"
                :description="field.description"
                :required="field.required"
              >
                <PluginsSecretField
                  :model-value="secretDraft(field.name)"
                  :field="field"
                  :saved="instance?.secrets[field.name]"
                  @update:model-value="state.secrets[field.name] = $event"
                />
              </UFormField>
            </template>
          </UForm>
        </div>
      </div>
    </template>

    <template #footer="{ close }">
      <UButton :label="customForm ? 'Close' : 'Cancel'" color="neutral" variant="outline" @click="close" />
      <UButton
        v-if="!customForm"
        type="submit"
        form="plugin-form"
        :label="isEdit ? 'Save' : 'Add plugin'"
        :loading="saving"
        data-testid="plugin-submit"
      />
    </template>
  </UModal>
</template>
