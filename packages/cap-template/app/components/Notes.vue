<script setup lang="ts">
import { z } from 'zod'
import { TEMPLATE_NOTE_MAX_LENGTH, workspaceTemplateNotesPath, type TemplateNoteResponse } from '../../src/wire'

defineProps<{ canCreate: boolean }>()

const { $api } = useNuxtApp()
const { slug } = useSelectedProject()
const toast = useToast()

const { notes, status, error: loadError, refresh } = useTemplateNotes()

const schema = z.object({ text: z.string().trim().min(1, 'Write something first').max(TEMPLATE_NOTE_MAX_LENGTH) })
const state = reactive({ text: '' })
const saving = ref(false)
const saveError = ref<ApiErrorInfo | null>(null)

async function onSubmit() {
  if (!slug.value) return
  saveError.value = null
  saving.value = true
  try {
    await $api<TemplateNoteResponse>(workspaceTemplateNotesPath(slug.value), { method: 'POST', body: { text: state.text } })
    state.text = ''
    toast.add({ title: 'Note added', color: 'success' })
    await refresh()
  }
  catch (error) {
    saveError.value = toApiError(error)
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <UForm v-if="canCreate" :schema="schema" :state="state" class="flex gap-2" data-testid="template-note-form" @submit="onSubmit">
      <UFormField name="text" class="flex-1">
        <UInput v-model="state.text" class="w-full" placeholder="A note" :maxlength="TEMPLATE_NOTE_MAX_LENGTH" data-testid="template-note-text" />
      </UFormField>
      <UButton type="submit" icon="i-lucide-plus" label="Add note" :loading="saving" data-testid="template-note-add" />
    </UForm>
    <UAlert v-if="saveError" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="saveError.message" />
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Could not load the notes"
      :description="toApiError(loadError).message"
    />

    <ul v-if="notes.length" class="divide-y divide-muted rounded-lg border border-default bg-default">
      <li v-for="note in notes" :key="note.id" class="px-4 py-3" data-testid="template-note">
        {{ note.text }}
      </li>
    </ul>
    <USkeleton v-else-if="status === 'pending'" class="h-24 w-full" />
    <UEmpty v-else-if="!loadError" icon="i-lucide-notebook-pen" title="No notes yet" data-testid="template-empty" />
  </div>
</template>
