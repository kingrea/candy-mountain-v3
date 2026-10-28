<script setup lang="ts">
import type { IssueDetail } from '@candy-mountain/shared'

const props = defineProps<{ slug: string }>()

const slots = defineSlots<{
  run?: (props: { issue: IssueDetail }) => unknown
}>()

const { issueId, canGoBack, push, back, close } = useIssuesSlideover(() => props.slug)
const copyId = useIssuesCopyId()
const issueTitle = ref<string | null>(null)
const body = useTemplateRef<HTMLElement>('body')

watch(issueId, () => {
  issueTitle.value = null
  body.value?.scrollTo({ top: 0 })
})

const open = computed({
  get: () => issueId.value !== null,
  set: (value) => {
    if (!value) close()
  },
})

// Escape inside a text field should cancel that edit, not dismiss the whole slide-out.
function onEscapeKeyDown(event: KeyboardEvent) {
  const target = event.target
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) event.preventDefault()
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="issueTitle ?? issueId ?? 'Issue'"
    :description="issueId ?? undefined"
    :content="{ onEscapeKeyDown }"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #content>
      <div
        v-if="issueId"
        class="flex min-h-(--ui-header-height) items-center gap-1 px-4 sm:px-6"
        data-testid="issue-slideover-header"
      >
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          aria-label="Back to the previous issue"
          :disabled="!canGoBack"
          data-testid="issue-slideover-back"
          @click="back"
        />
        <span class="min-w-0 truncate font-mono text-sm text-highlighted" data-testid="issue-slideover-id">{{ issueId }}</span>
        <UButton
          icon="i-lucide-copy"
          color="neutral"
          variant="ghost"
          size="xs"
          aria-label="Copy issue id"
          data-testid="issue-slideover-copy"
          @click="copyId(issueId)"
        />
        <div class="ms-auto flex shrink-0 items-center gap-1">
          <UButton
            :to="issuesPagePath(slug, issueId)"
            label="Open page"
            icon="i-lucide-maximize-2"
            color="neutral"
            variant="ghost"
            size="sm"
            data-testid="issue-slideover-open-page"
          />
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            aria-label="Close"
            data-testid="issue-slideover-close"
            @click="close"
          />
        </div>
      </div>

      <div ref="body" class="flex-1 overflow-y-auto p-4 sm:p-6" data-testid="issue-slideover-body">
        <IssuesDetailHost
          v-if="issueId"
          :key="issueId"
          :slug="slug"
          :issue-id="issueId"
          @open-issue="push"
          @loaded="issueTitle = $event.title"
        >
          <template v-if="slots.run" #run="scope">
            <slot name="run" v-bind="scope" />
          </template>
        </IssuesDetailHost>
      </div>
    </template>
  </USlideover>
</template>
