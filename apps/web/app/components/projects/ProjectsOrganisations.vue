<script setup lang="ts">
import {
  ORGANISATIONS_PATH,
  type Organisation,
  type OrganisationResponse,
  type Project,
} from '@candy-mountain/shared'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'
import ProjectsConfirmModal from './ProjectsConfirmModal.vue'

const props = defineProps<{
  organisations: Organisation[]
  projects: Project[]
}>()

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'At most 200 characters'),
})
type Schema = z.output<typeof schema>

const { $api } = useNuxtApp()
const overlay = useOverlay()
const confirm = overlay.create(ProjectsConfirmModal)

const projectCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const project of props.projects) {
    if (project.organisationId) counts.set(project.organisationId, (counts.get(project.organisationId) ?? 0) + 1)
  }
  return counts
})

const createForm = useTemplateRef('createForm')
const createState = reactive<Schema>({ name: '' })
const creating = ref(false)

async function onCreate(event: FormSubmitEvent<Schema>) {
  creating.value = true
  try {
    await $api<OrganisationResponse>(ORGANISATIONS_PATH, { method: 'POST', body: { name: event.data.name } })
    createState.name = ''
    await refreshProjectData()
  }
  catch (error) {
    createForm.value?.setErrors([{ name: 'name', message: toApiError(error).message }])
  }
  finally {
    creating.value = false
  }
}

const renaming = ref<string | null>(null)
const renameError = ref<string | undefined>()
const renameState = reactive<Schema>({ name: '' })
const savingRename = ref(false)

function startRename(organisation: Organisation) {
  renaming.value = organisation.id
  renameState.name = organisation.name
  renameError.value = undefined
}

async function onRename(event: FormSubmitEvent<Schema>, organisation: Organisation) {
  savingRename.value = true
  renameError.value = undefined
  try {
    await $api<OrganisationResponse>(`${ORGANISATIONS_PATH}/${organisation.slug}`, {
      method: 'PATCH',
      body: { name: event.data.name },
    })
    renaming.value = null
    await refreshProjectData()
  }
  catch (error) {
    renameError.value = toApiError(error).message
  }
  finally {
    savingRename.value = false
  }
}

const deleteError = ref<ApiErrorInfo | null>(null)

async function remove(organisation: Organisation) {
  const count = projectCounts.value.get(organisation.id) ?? 0
  const confirmed = await confirm.open({
    title: `Delete ${organisation.name}?`,
    description: count === 0
      ? `It has no ${SCOPE.plural}.`
      : `Its ${SCOPE.count(count)} will move to No organisation.`,
    confirmLabel: 'Delete organisation',
  }).result
  if (!confirmed) return

  deleteError.value = null
  try {
    await $api(`${ORGANISATIONS_PATH}/${organisation.slug}`, { method: 'DELETE' })
    await refreshProjectData()
  }
  catch (error) {
    deleteError.value = toApiError(error)
  }
}
</script>

<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }" data-testid="organisations">
    <template #header>
      <h2 class="font-semibold text-highlighted">
        Organisations
      </h2>
      <p class="text-sm text-muted">
        Groups for the {{ SCOPE.singular }} picker.
      </p>
    </template>

    <UAlert
      v-if="deleteError"
      class="m-4"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="deleteError.message"
      :close="{ onClick: () => { deleteError = null } }"
    />

    <ul v-if="organisations.length" class="divide-y divide-default">
      <li
        v-for="organisation in organisations"
        :key="organisation.id"
        class="px-4 py-3"
        :data-organisation="organisation.slug"
      >
        <UForm
          v-if="renaming === organisation.id"
          :schema="schema"
          :state="renameState"
          class="flex items-start gap-2"
          @submit="onRename($event, organisation)"
        >
          <UFormField name="name" class="flex-1" :error="renameError">
            <UInput v-model="renameState.name" class="w-full" autofocus aria-label="Organisation name" />
          </UFormField>
          <UButton type="submit" icon="i-lucide-check" aria-label="Save name" :loading="savingRename" />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            aria-label="Cancel rename"
            @click="renaming = null"
          />
        </UForm>

        <div v-else class="flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium text-highlighted">
              {{ organisation.name }}
            </p>
            <p class="text-xs text-muted">
              {{ SCOPE.count(projectCounts.get(organisation.id) ?? 0) }}
            </p>
          </div>
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="`Rename ${organisation.name}`"
            @click="startRename(organisation)"
          />
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            size="sm"
            :aria-label="`Delete ${organisation.name}`"
            @click="remove(organisation)"
          />
        </div>
      </li>
    </ul>
    <p v-else class="px-4 py-3 text-sm text-muted">
      No organisations yet.
    </p>

    <template #footer>
      <UForm
        ref="createForm"
        :schema="schema"
        :state="createState"
        class="flex items-start gap-2"
        @submit="onCreate"
      >
        <UFormField name="name" class="flex-1">
          <UInput v-model="createState.name" class="w-full" placeholder="New organisation" aria-label="New organisation name" />
        </UFormField>
        <UButton type="submit" icon="i-lucide-plus" label="Add" :loading="creating" />
      </UForm>
    </template>
  </UCard>
</template>
