<script setup lang="ts">
import {
  WORKSPACE_COLOR_PALETTE,
  WORKSPACE_COLOR_PATTERN,
  WORKSPACES_PATH,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  slugify,
  type CreateWorkspaceRequest,
  type Organisation,
  type Workspace,
  type WorkspaceResponse,
  type UpdateWorkspaceRequest,
} from '@candy-mountain/shared'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

const props = defineProps<{
  project: Workspace | null
  organisations: Organisation[]
}>()

const emit = defineEmits<{
  saved: [project: Workspace, created: boolean, notes: ProjectFormSaveNote[]]
}>()

const open = defineModel<boolean>('open', { required: true })

const NO_ORGANISATION = 'none'

const baseSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'At most 200 characters'),
  slug: z.string().trim()
    .min(1, 'Slug is required')
    .max(SLUG_MAX_LENGTH, `At most ${SLUG_MAX_LENGTH} characters`)
    .regex(SLUG_PATTERN, 'Lowercase letters and digits joined by single hyphens'),
  color: z.string().regex(WORKSPACE_COLOR_PATTERN, 'Pick a colour'),
  organisationId: z.string(),
})
type Schema = z.output<typeof baseSchema> & Record<string, unknown>

const fields = projectFormFields()
const schema = projectFormSchema(baseSchema)

const { $api } = useNuxtApp()
const form = useTemplateRef('form')
// Once a create succeeds, a retry after a failed field hook updates that project instead of creating another.
const saved = ref<Workspace | null>(null)
const target = computed(() => saved.value ?? props.project)
const isEdit = computed(() => props.project !== null)
const state = reactive<Schema>(initialState())
const slugTouched = ref(false)
const saving = ref(false)
const formError = ref<ApiErrorInfo | null>(null)

const organisationItems = computed(() => [
  { label: 'No organisation', value: NO_ORGANISATION },
  ...props.organisations.map(organisation => ({ label: organisation.name, value: organisation.id })),
])

function initialState(): Schema {
  const project = props.project
  return {
    name: project?.name ?? '',
    slug: project?.slug ?? '',
    color: project?.color ?? WORKSPACE_COLOR_PALETTE[0],
    organisationId: project?.organisationId ?? NO_ORGANISATION,
    ...projectFormInitial(project),
  }
}

watch(() => state.name, (name) => {
  if (!slugTouched.value) state.slug = slugify(name)
})

watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(state, initialState())
  // Renaming an existing project never changes its slug, matching the daemon.
  slugTouched.value = isEdit.value
  formError.value = null
  saved.value = null
}, { immediate: true })

const FIELD_FOR_CODE: Record<string, string> = {
  slug_taken: 'slug',
  organisation_not_found: 'organisationId',
}

function organisationId(value: string): string | null {
  return value === NO_ORGANISATION ? null : value
}

function createBody(data: Schema): Partial<CreateWorkspaceRequest> {
  return {
    name: data.name,
    slug: slugTouched.value ? data.slug : undefined,
    color: data.color,
    organisationId: organisationId(data.organisationId),
    ...projectFormRequest(data, null),
  }
}

function updateBody(data: Schema, project: Workspace): UpdateWorkspaceRequest {
  return {
    name: data.name,
    slug: data.slug === project.slug ? undefined : data.slug,
    color: data.color,
    organisationId: organisationId(data.organisationId),
    ...projectFormRequest(data, project),
  }
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  formError.value = null
  saving.value = true
  const project = target.value
  try {
    const response = project
      ? await $api<WorkspaceResponse>(`${WORKSPACES_PATH}/${project.slug}`, { method: 'PATCH', body: updateBody(event.data, project) })
      : await $api<WorkspaceResponse>(WORKSPACES_PATH, { method: 'POST', body: createBody(event.data) })
    const created = !props.project
    saved.value = response.workspace
    try {
      const notes = await projectFormAfterSave(response.workspace, event.data, created)
      emit('saved', response.workspace, created, notes)
      open.value = false
    }
    catch (error) {
      emit('saved', response.workspace, created, [])
      throw error
    }
  }
  catch (error) {
    const apiError = toApiError(error)
    const field = FIELD_FOR_CODE[apiError.code] ?? projectFormErrorField(apiError.code)
    if (field) form.value?.setErrors([{ name: field, message: apiError.message }])
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
    :title="isEdit ? `Edit ${project?.name}` : `New ${SCOPE.singular}`"
    :description="projectFormDescription(isEdit)"
    :ui="{ footer: 'justify-end' }"
  >
    <template #body>
      <UForm
        id="project-form"
        ref="form"
        :schema="schema"
        :state="state"
        class="flex flex-col gap-4"
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

        <UFormField name="name" label="Name" required>
          <UInput v-model="state.name" class="w-full" autofocus :placeholder="PRODUCT.name" />
        </UFormField>

        <UFormField
          name="slug"
          label="Slug"
          required
          :description="isEdit ? `Changing the slug changes every ${SCOPE.singular} URL.` : 'Derived from the name until you edit it.'"
        >
          <UInput v-model="state.slug" class="w-full font-mono" @update:model-value="slugTouched = true" />
        </UFormField>

        <UFormField name="color" label="Colour">
          <ProjectsColorPicker v-model="state.color" />
        </UFormField>

        <UFormField name="organisationId" label="Organisation">
          <USelect v-model="state.organisationId" :items="organisationItems" class="w-full" />
        </UFormField>

        <component
          :is="field.component"
          v-for="field in fields"
          :key="field.name"
          v-model="state[field.name]"
          :project="project"
          :open="open"
        />
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton label="Cancel" color="neutral" variant="outline" @click="close" />
      <UButton
        type="submit"
        form="project-form"
        :label="isEdit ? 'Save' : `Create ${SCOPE.singular}`"
        :loading="saving"
      />
    </template>
  </UModal>
</template>
