<script setup lang="ts">
const props = defineProps<{
  title: string
  source: string | null
  editable: boolean
  saving: boolean
  error: ApiErrorInfo | null
  /** Resolves true once the write landed; false keeps the editor open with the draft. */
  save: (value: string) => Promise<boolean>
}>()

const emit = defineEmits<{ cancel: [] }>()

const editing = ref(false)
const draft = ref('')

function start() {
  draft.value = props.source ?? ''
  editing.value = true
}

function cancel() {
  editing.value = false
  emit('cancel')
}

async function submit() {
  if (await props.save(draft.value)) editing.value = false
}
</script>

<template>
  <section class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-highlighted">
        {{ title }}
      </h2>
      <UButton
        v-if="editable && !editing"
        icon="i-lucide-pencil"
        label="Edit"
        size="xs"
        color="neutral"
        variant="ghost"
        :aria-label="`Edit ${title.toLowerCase()}`"
        data-testid="issue-section-edit"
        @click="start"
      />
    </div>

    <form v-if="editing" class="flex flex-col gap-2" @submit.prevent="submit">
      <UTextarea
        v-model="draft"
        :rows="6"
        :maxrows="30"
        autoresize
        autofocus
        class="w-full"
        :ui="{ base: 'font-mono text-sm' }"
        :aria-label="title"
        placeholder="Markdown"
        data-testid="issue-section-input"
        @keydown.meta.enter.prevent="submit"
        @keydown.ctrl.enter.prevent="submit"
      />
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="`Couldn't save the ${title.toLowerCase()}`"
        :description="error.message"
        data-testid="issue-edit-error"
      />
      <div class="flex items-center justify-end gap-2">
        <span class="mr-auto text-xs text-dimmed">Markdown · Ctrl+Enter to save</span>
        <UButton label="Cancel" color="neutral" variant="ghost" :disabled="saving" @click="cancel" />
        <UButton type="submit" label="Save" :loading="saving" data-testid="issue-section-save" />
      </div>
    </form>

    <IssuesDetailMarkdown v-else-if="source?.trim()" :source="source" />
    <p v-else class="text-sm text-dimmed">
      Nothing yet.
    </p>
  </section>
</template>
