<script setup lang="ts">
import { REPOSITORY_CHECK_PATH, type RepositoryCheckResponse, type RepositoryVerification } from '@candy-mountain/shared'

const props = defineProps<ProjectFormFieldProps>()

const path = defineModel<string>({ required: true })

const PREVIEW_DELAY_MS = 400

const { $api } = useNuxtApp()

const { repository } = useRepository(() => props.project?.slug ?? null)

const preview = reactive<{
  checking: boolean
  path: string
  verification: RepositoryVerification | null
  error: ApiErrorInfo | null
}>({ checking: false, path: '', verification: null, error: null })
let previewTimer: ReturnType<typeof setTimeout> | undefined
let previewRequest = 0

function resetPreview() {
  clearTimeout(previewTimer)
  previewRequest++
  path.value = repository.value?.source.path ?? ''
  Object.assign(preview, {
    checking: false,
    path: repository.value?.source.path ?? '',
    verification: repository.value?.verification ?? null,
    error: null,
  })
}

async function runPreview(path: string) {
  const request = ++previewRequest
  preview.checking = true
  try {
    const { verification } = await $api<RepositoryCheckResponse>(REPOSITORY_CHECK_PATH, { method: 'POST', body: { path } })
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

watch(path, (raw) => {
  clearTimeout(previewTimer)
  const trimmed = raw.trim()
  if (!props.open || trimmed === preview.path) return
  previewRequest++
  if (!repositoryIsAbsoluteish(trimmed)) {
    Object.assign(preview, { checking: false, path: '', verification: null, error: null })
    return
  }
  Object.assign(preview, { checking: true, path: '', verification: null, error: null })
  previewTimer = setTimeout(() => runPreview(trimmed), PREVIEW_DELAY_MS)
})

onBeforeUnmount(() => clearTimeout(previewTimer))

watch(() => props.open, (isOpen) => {
  if (isOpen) resetPreview()
}, { immediate: true })

// The stored repository may arrive after the form opened; it fills a path nobody has typed in yet.
watch(repository, (stored) => {
  if (props.open && stored && path.value === '') resetPreview()
})

const previewIsStored = computed(() =>
  repository.value !== null && preview.verification !== null && preview.verification === repository.value.verification,
)
</script>

<template>
  <UFormField name="path" label="Local path" required>
    <UInput
      v-model="path"
      class="w-full font-mono"
      placeholder="~/code/my-app"
      :loading="preview.checking"
    />
    <template #help>
      <div class="flex min-h-6 flex-wrap items-center gap-2" data-testid="path-preview">
        <span v-if="preview.checking" class="text-muted">Checking path…</span>
        <span v-else-if="preview.error" class="text-error">{{ preview.error.message }}</span>
        <template v-else-if="preview.verification">
          <RepositoryVerificationFacts :verification="preview.verification" />
          <span v-if="previewIsStored" class="text-xs text-dimmed">as last saved</span>
        </template>
      </div>
    </template>
  </UFormField>
</template>
