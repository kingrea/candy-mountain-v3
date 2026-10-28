<script setup lang="ts">
import type { Issue } from '@candy-mountain/shared'

const props = defineProps<{
  slug: string
  issue: Issue
  selected: boolean
}>()

const emit = defineEmits<{
  open: [id: string]
  toggle: [id: string, selected: boolean]
}>()

const copyId = useIssuesCopyId()

const closed = computed(() => props.issue.status === 'closed')
const stages = computed(() => issuesSplitLabels(props.issue.labels).stages)
const research = computed(() => props.issue.labels.includes('research'))
const status = computed(() => issuesStatusMeta(props.issue.status))
const type = computed(() => issuesTypeMeta(props.issue.type))

function openFromLink(event: MouseEvent) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    event.stopPropagation()
    return
  }
  event.preventDefault()
}
</script>

<template>
  <div
    class="group @container/row flex cursor-pointer items-center gap-2 rounded-md @md/row:gap-3 px-2 py-1.5 font-mono text-sm hover:bg-elevated/60"
    :class="{ 'bg-elevated/40': selected }"
    data-testid="issues-row"
    :data-issue-id="issue.id"
    @click="emit('open', issue.id)"
  >
    <span class="flex items-center" @click.stop>
      <UCheckbox
        :model-value="selected"
        :aria-label="`Select ${issue.id}`"
        data-testid="issues-row-select"
        @update:model-value="value => emit('toggle', issue.id, value === true)"
      />
    </span>

    <span class="flex w-5 shrink-0 justify-center" :title="`Priority P${issue.priority}`">
      <UIcon name="i-lucide-flame" class="size-4" :class="issuesPriorityFlameClass(issue.priority)" />
      <span class="sr-only">P{{ issue.priority }}</span>
    </span>

    <span class="flex w-20 shrink-0 items-center gap-0.5 @md/row:w-28" @click.stop>
      <UTooltip :text="issue.id" :content="{ side: 'top' }">
        <span class="truncate text-xs text-muted" data-testid="issues-row-id">{{ issuesShortId(issue.id) }}</span>
      </UTooltip>
      <button
        type="button"
        class="hidden rounded-sm p-1 text-muted opacity-0 group-hover:opacity-100 @md/row:flex hover:text-highlighted focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary"
        :aria-label="`Copy ${issue.id}`"
        data-testid="issues-row-copy"
        @click="copyId(issue.id)"
      >
        <UIcon name="i-lucide-copy" class="size-3.5" />
      </button>
    </span>

    <NuxtLink
      :to="issuesPagePath(slug, issue.id)"
      no-prefetch
      class="min-w-16 flex-1 truncate"
      :class="closed ? 'text-muted line-through' : 'text-default'"
      data-testid="issues-row-title"
      @click="openFromLink"
    >
      {{ issue.title }}
    </NuxtLink>

    <UBadge
      v-for="stage in stages"
      :key="stage"
      :label="stage"
      variant="outline"
      size="sm"
      class="hidden shrink-0 bg-violet-100 text-violet-800 ring-violet-300 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-900 @3xl/row:inline-flex"
      data-testid="issues-row-stage"
    />
    <UBadge
      v-if="research"
      label="research"
      icon="i-lucide-microscope"
      variant="outline"
      size="sm"
      class="hidden shrink-0 bg-sky-100 text-sky-800 ring-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900 @3xl/row:inline-flex"
      data-testid="issues-row-research"
    />

    <UBadge
      :label="status.label"
      :color="status.color"
      variant="subtle"
      size="sm"
      class="hidden w-24 shrink-0 justify-center @md/row:inline-flex"
      data-testid="issues-row-status"
    />
    <UIcon :name="status.icon" class="size-4 shrink-0 @md/row:hidden" :class="ISSUES_STATUS_TEXT_CLASSES[status.color]" :aria-label="status.label" />

    <span
      class="flex shrink-0 items-center gap-1 text-xs @4xl/row:w-20"
      :class="issuesTypeColorClass(issue.type)"
      :title="type.label"
      data-testid="issues-row-type"
    >
      <UIcon :name="type.icon" class="size-3.5 shrink-0" />
      <span class="hidden truncate @4xl/row:inline">{{ issue.type }}</span>
    </span>

    <span class="hidden w-28 shrink-0 truncate text-xs text-muted @2xl/row:block" data-testid="issues-row-assignee">{{ issue.assignee }}</span>

    <span class="hidden w-10 shrink-0 items-center justify-end gap-1 text-xs text-muted @xl/row:flex">
      <template v-if="issue.commentCount > 0">
        <UIcon name="i-lucide-message-square" class="size-3.5" />
        <span data-testid="issues-row-comments">{{ issue.commentCount }}</span>
      </template>
    </span>
  </div>
</template>
