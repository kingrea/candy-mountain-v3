<script setup lang="ts">
const props = defineProps<{ slug: string, issueId: string }>()

const { comments, status, error, refresh, saving, writeError, add, edit } = useIssuesComments(
  () => props.slug,
  () => props.issueId,
)

const draft = ref('')
const editingId = ref<string | null>(null)
const editDraft = ref('')

async function submit() {
  const text = draft.value.trim()
  if (!text) return
  if (await add(text)) draft.value = ''
}

function startEdit(id: string, text: string) {
  writeError.value = null
  editingId.value = id
  editDraft.value = text
}

function cancelEdit() {
  editingId.value = null
  writeError.value = null
}

async function save(id: string) {
  const text = editDraft.value.trim()
  if (!text) return
  if (await edit(id, text)) editingId.value = null
}
</script>

<template>
  <section class="space-y-4" data-testid="issue-comments">
    <h2 class="text-sm font-semibold text-highlighted">
      Comments
      <span v-if="comments.length" class="font-normal text-muted">({{ comments.length }})</span>
    </h2>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load comments"
      :description="toApiError(error).message"
      :actions="[{ label: 'Try again', onClick: () => refresh() }]"
      data-testid="comments-error"
    />
    <USkeleton v-else-if="status === 'pending' && !comments.length" class="h-16 w-full" />
    <p v-else-if="!comments.length" class="text-sm text-muted" data-testid="comments-empty">
      No comments yet.
    </p>

    <ul v-if="comments.length" class="space-y-3">
      <li
        v-for="comment in comments"
        :key="comment.id"
        class="rounded-md border border-default p-3"
        data-testid="comment"
      >
        <div class="mb-2 flex items-center gap-2 text-xs text-muted">
          <span class="font-medium text-default" data-testid="comment-author">{{ comment.author ?? 'Unknown' }}</span>
          <NuxtTime v-if="comment.createdAt" :datetime="comment.createdAt" date-style="medium" time-style="short" data-testid="comment-time" />
          <UButton
            v-if="editingId !== comment.id"
            class="ml-auto"
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-pencil"
            label="Edit"
            data-testid="comment-edit"
            @click="startEdit(comment.id, comment.text)"
          />
        </div>

        <form v-if="editingId === comment.id" class="space-y-2" @submit.prevent="save(comment.id)">
          <UTextarea
            v-model="editDraft"
            :rows="4"
            autoresize
            class="w-full"
            aria-label="Edit comment"
            data-testid="comment-edit-input"
          />
          <div class="flex gap-2">
            <UButton type="submit" size="sm" label="Save" :loading="saving" :disabled="!editDraft.trim()" data-testid="comment-save" />
            <UButton size="sm" color="neutral" variant="ghost" label="Cancel" :disabled="saving" data-testid="comment-cancel" @click="cancelEdit" />
          </div>
        </form>
        <IssuesDetailMarkdown v-else :source="comment.text" data-testid="comment-body" />
      </li>
    </ul>

    <form class="space-y-2" @submit.prevent="submit">
      <UTextarea
        v-model="draft"
        :rows="3"
        autoresize
        class="w-full"
        placeholder="Add a comment (markdown)"
        aria-label="New comment"
        data-testid="comment-input"
      />
      <UButton
        type="submit"
        size="sm"
        label="Comment"
        :loading="saving && editingId === null"
        :disabled="!draft.trim() || saving"
        data-testid="comment-submit"
      />
    </form>

    <UAlert
      v-if="writeError"
      color="error"
      variant="subtle"
      title="Comment not saved"
      :description="writeError"
      data-testid="comment-write-error"
    />
  </section>
</template>
