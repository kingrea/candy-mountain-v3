<script setup lang="ts">
import {
  ISSUE_TEXT_MAX_LENGTH,
  ISSUE_TITLE_MAX_LENGTH,
  KNOWN_ISSUE_TYPES,
  type CreateIssueResponse,
  type Issue,
} from '@candy-mountain/shared'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'
import type { IssuesCreateFormData } from '#layers/issues/app/utils/issue-create'

const props = defineProps<{
  slug: string
}>()

const emit = defineEmits<{
  created: [response: CreateIssueResponse]
  back: []
}>()

const textField = z.string().max(ISSUE_TEXT_MAX_LENGTH, `At most ${ISSUE_TEXT_MAX_LENGTH} characters`)

const schema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(ISSUE_TITLE_MAX_LENGTH, `At most ${ISSUE_TITLE_MAX_LENGTH} characters`),
  type: z.enum(KNOWN_ISSUE_TYPES),
  priority: z.number().int().min(0).max(4),
  labels: z.array(z.string()),
  parentId: z.string().nullable(),
  description: textField,
  acceptanceCriteria: textField,
  dependsOn: z.array(z.string()),
}) satisfies z.ZodType<IssuesCreateFormData>
type Schema = z.output<typeof schema>

const api = useIssuesApi()
const state = reactive<Schema>({
  title: '',
  type: 'task',
  priority: 2,
  labels: [],
  parentId: null,
  description: '',
  acceptanceCriteria: '',
  dependsOn: [],
})
const saving = ref(false)
const formError = ref<ApiErrorInfo | null>(null)

const typeItems = KNOWN_ISSUE_TYPES.map(type => ({ label: type.charAt(0).toUpperCase() + type.slice(1), value: type }))

const issues = ref<Issue[]>([])
const issuesPending = ref(true)
const issuesError = ref<ApiErrorInfo | null>(null)
const issueItems = computed(() => issuesPickerItems(issues.value))
const pickerFilterFields = ['label', 'value']

onMounted(async () => {
  try {
    issues.value = (await api.list(props.slug)).issues
  }
  catch (error) {
    issuesError.value = toApiError(error)
  }
  finally {
    issuesPending.value = false
  }
})

async function onSubmit(event: FormSubmitEvent<Schema>) {
  formError.value = null
  saving.value = true
  try {
    emit('created', await api.create(props.slug, issuesCreateRequest(event.data)))
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
  <UForm
    :schema="schema"
    :state="state"
    class="flex flex-col gap-4"
    data-testid="issue-create-form"
    @submit="onSubmit"
  >
    <UAlert
      v-if="formError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="formError.message"
      :description="formError.code"
      data-testid="issue-create-error"
    />

    <UFormField name="title" label="Title" required>
      <UInput v-model="state.title" class="w-full" autofocus placeholder="What needs doing?" data-testid="issue-create-title" />
    </UFormField>

    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField name="type" label="Type">
        <USelect v-model="state.type" :items="typeItems" class="w-full" data-testid="issue-create-type" />
      </UFormField>
      <UFormField name="priority" label="Priority">
        <USelect v-model="state.priority" :items="ISSUES_PRIORITY_ITEMS" class="w-full" data-testid="issue-create-priority" />
      </UFormField>
    </div>

    <UFormField name="labels" label="Labels" hint="Optional" description="Press Enter or type a comma after each label.">
      <UInputTags
        v-model="state.labels"
        class="w-full"
        placeholder="Add a label"
        add-on-blur
        add-on-paste
        data-testid="issue-create-labels"
      />
    </UFormField>

    <UFormField name="parentId" label="Parent" hint="Optional">
      <IssuesParentPicker v-model="state.parentId" :slug="slug" class="w-full" data-testid="issue-create-parent" />
    </UFormField>

    <UFormField name="description" label="Description" hint="Markdown">
      <UTextarea v-model="state.description" class="w-full" :rows="4" autoresize :maxrows="12" data-testid="issue-create-description" />
    </UFormField>

    <UFormField name="acceptanceCriteria" label="Acceptance criteria" hint="Markdown">
      <UTextarea v-model="state.acceptanceCriteria" class="w-full" :rows="3" autoresize :maxrows="10" data-testid="issue-create-acceptance" />
    </UFormField>

    <UFormField name="dependsOn" label="Depends on" hint="Optional" description="Issues that must be finished before this one." :error="issuesError?.message">
      <USelectMenu
        v-model="state.dependsOn"
        :items="issueItems"
        value-key="value"
        multiple
        :filter-fields="pickerFilterFields"
        :search-input="{ placeholder: 'Search by title or id' }"
        :loading="issuesPending"
        placeholder="Nothing"
        virtualize
        class="w-full"
        data-testid="issue-create-depends-on"
      />
    </UFormField>

    <div class="flex justify-between gap-2">
      <UButton label="Back" color="neutral" variant="ghost" icon="i-lucide-arrow-left" @click="emit('back')" />
      <UButton type="submit" label="Done" :loading="saving" data-testid="issue-create-submit" />
    </div>
  </UForm>
</template>
