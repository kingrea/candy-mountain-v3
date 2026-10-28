<script setup lang="ts">
import {
  PROJECT_COLOR_PALETTE,
  PROJECT_COLOR_PATTERN,
  PROJECTS_PATH,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  slugify,
  type CreateProjectRequest,
  type Organisation,
  type PathVerification,
  type Project,
  type ProjectResponse,
  type UpdateProjectRequest,
  type VerifyPathResponse,
} from '@candy-mountain/shared'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

const props = defineProps<{
  project: Project | null
  organisations: Organisation[]
}>()

const emit = defineEmits<{
  saved: [project: Project, created: boolean]
}>()

const open = defineModel<boolean>('open', { required: true })

const NO_ORGANISATION = 'none'
const PREVIEW_DELAY_MS = 400

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'At most 200 characters'),
  slug: z.string().trim()
    .min(1, 'Slug is required')
    .max(SLUG_MAX_LENGTH, `At most ${SLUG_MAX_LENGTH} characters`)
    .regex(SLUG_PATTERN, 'Lowercase letters and digits joined by single hyphens'),
  color: z.string().regex(PROJECT_COLOR_PATTERN, 'Pick a colour'),
  organisationId: z.string(),
  path: z.string().trim()
    .min(1, 'Path is required')
    .refine(isAbsoluteish, 'Use an absolute path, such as /home/you/code/app or ~/code/app'),
})
type Schema = z.output<typeof schema>

const { $api } = useNuxtApp()
const form = useTemplateRef('form')
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
    color: project?.color ?? PROJECT_COLOR_PALETTE[0],
    organisationId: project?.organisationId ?? NO_ORGANISATION,
    path: project?.source.path ?? '',
  }
}

function isAbsoluteish(path: string): boolean {
  return path.startsWith('/') || path === '~' || path.startsWith('~/')
}

watch(() => state.name, (name) => {
  if (!slugTouched.value) state.slug = slugify(name)
})

const preview = reactive<{
  checking: boolean
  path: string
  verification: PathVerification | null
  error: ApiErrorInfo | null
}>({ checking: false, path: '', verification: null, error: null })
let previewTimer: ReturnType<typeof setTimeout> | undefined
let previewRequest = 0

function resetPreview() {
  clearTimeout(previewTimer)
  previewRequest++
  Object.assign(preview, {
    checking: false,
    path: props.project?.source.path ?? '',
    verification: props.project?.verification ?? null,
    error: null,
  })
}

async function runPreview(path: string) {
  const request = ++previewRequest
  preview.checking = true
  try {
    const { verification } = await $api<VerifyPathResponse>(`${PROJECTS_PATH}/verify-path`, { method: 'POST', body: { path } })
    if (request !== previewRequest) return
    Object.assign(preview, { path, verification, error: null })
  }
  catch (error) {
    if (request !== previewRequest) return
    Object.assign(preview, { path, verification: null, error: toApiError(error) })
  }
  finally {
    if (request === previewRequest) preview.checking = false
  }
}

watch(() => state.path, (raw) => {
  clearTimeout(previewTimer)
  const path = raw.trim()
  if (!open.value || path === preview.path) return
  previewRequest++
  if (!isAbsoluteish(path)) {
    Object.assign(preview, { checking: false, path: '', verification: null, error: null })
    return
  }
  Object.assign(preview, { checking: true, path: '', verification: null, error: null })
  previewTimer = setTimeout(() => runPreview(path), PREVIEW_DELAY_MS)
})

onBeforeUnmount(() => clearTimeout(previewTimer))

watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(state, initialState())
  // Renaming an existing project never changes its slug, matching the daemon.
  slugTouched.value = isEdit.value
  formError.value = null
  resetPreview()
}, { immediate: true })

const previewIsStored = computed(() =>
  isEdit.value && preview.verification !== null && preview.verification === props.project?.verification,
)

const FIELD_FOR_CODE: Record<string, keyof Schema> = {
  slug_taken: 'slug',
  invalid_path: 'path',
  path_not_found: 'path',
  organisation_not_found: 'organisationId',
}

function organisationId(value: string): string | null {
  return value === NO_ORGANISATION ? null : value
}

function createBody(data: Schema): CreateProjectRequest {
  return {
    name: data.name,
    slug: slugTouched.value ? data.slug : undefined,
    color: data.color,
    organisationId: organisationId(data.organisationId),
    source: { kind: 'local-path', path: data.path },
  }
}

function updateBody(data: Schema, project: Project): UpdateProjectRequest {
  return {
    name: data.name,
    slug: data.slug === project.slug ? undefined : data.slug,
    color: data.color,
    organisationId: organisationId(data.organisationId),
    source: { kind: 'local-path', path: data.path },
  }
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  formError.value = null
  saving.value = true
  const project = props.project
  try {
    const response = project
      ? await $api<ProjectResponse>(`${PROJECTS_PATH}/${project.slug}`, { method: 'PATCH', body: updateBody(event.data, project) })
      : await $api<ProjectResponse>(PROJECTS_PATH, { method: 'POST', body: createBody(event.data) })
    emit('saved', response.project, !project)
    open.value = false
  }
  catch (error) {
    const apiError = toApiError(error)
    const field = FIELD_FOR_CODE[apiError.code]
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
    :title="isEdit ? `Edit ${project?.name}` : 'New project'"
    :description="isEdit ? 'Saving re-checks the path.' : 'Register a local codebase.'"
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
          <UInput v-model="state.name" class="w-full" autofocus placeholder="Candy Mountain" />
        </UFormField>

        <UFormField
          name="slug"
          label="Slug"
          required
          :description="isEdit ? 'Changing the slug changes every project URL.' : 'Derived from the name until you edit it.'"
        >
          <UInput v-model="state.slug" class="w-full font-mono" @update:model-value="slugTouched = true" />
        </UFormField>

        <UFormField name="color" label="Colour">
          <ProjectsColorPicker v-model="state.color" />
        </UFormField>

        <UFormField name="organisationId" label="Organisation">
          <USelect v-model="state.organisationId" :items="organisationItems" class="w-full" />
        </UFormField>

        <UFormField name="path" label="Local path" required>
          <UInput
            v-model="state.path"
            class="w-full font-mono"
            placeholder="~/code/my-app"
            :loading="preview.checking"
          />
          <template #help>
            <div class="flex min-h-6 flex-wrap items-center gap-2" data-testid="path-preview">
              <span v-if="preview.checking" class="text-muted">Checking path…</span>
              <span v-else-if="preview.error" class="text-error">{{ preview.error.message }}</span>
              <template v-else-if="preview.verification">
                <ProjectsVerificationFacts :verification="preview.verification" />
                <span v-if="previewIsStored" class="text-xs text-dimmed">as last saved</span>
              </template>
            </div>
          </template>
        </UFormField>
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton label="Cancel" color="neutral" variant="outline" @click="close" />
      <UButton
        type="submit"
        form="project-form"
        :label="isEdit ? 'Save' : 'Create project'"
        :loading="saving"
      />
    </template>
  </UModal>
</template>
