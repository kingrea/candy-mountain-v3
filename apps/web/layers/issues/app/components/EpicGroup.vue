<script setup lang="ts">
import type { Issue } from '@candy-mountain/shared'
import type { IssuesEpicNode } from '#layers/issues/app/utils/issues-tree'

const props = defineProps<{
  slug: string
  groupKey: string
  title: string
  /** Null for the bucket of issues outside any epic. */
  epic: Issue | null
  issues: Issue[]
  epics: IssuesEpicNode[]
  openCount: number
  totalCount: number
  depth?: number
}>()

const emit = defineEmits<{ open: [id: string] }>()

const view = useIssuesListState(props.slug)
const selection = useIssuesSelection(props.slug)

const open = computed({
  get: () => !view.collapsedIds.value.has(props.groupKey),
  set: value => view.setCollapsed(props.groupKey, !value),
})
const nested = computed(() => (props.depth ?? 0) > 0)
const contentId = computed(() => `issues-group-${props.groupKey}`)
const groupIds = computed(() => issuesGroupIssueIds(props.issues, props.epics))
const selectState = computed(() => issuesGroupSelectState(groupIds.value, selection.ids.value))

function selectGroup(value: boolean | 'indeterminate') {
  if (value === true) selection.select(groupIds.value)
  else selection.deselect(groupIds.value)
}
</script>

<template>
  <section
    :class="nested ? 'mt-1 border-l border-default pl-2 sm:pl-3' : 'rounded-lg border border-default bg-default py-1'"
    data-testid="issues-group"
    :data-group-key="groupKey"
    :data-depth="depth ?? 0"
  >
    <div class="flex min-w-0 items-center gap-2 px-2" :class="nested ? 'py-0.5 text-sm' : 'py-1.5'">
      <UCheckbox
        v-if="groupIds.length > 0"
        :model-value="selectState"
        :aria-label="`Select all in ${title}`"
        data-testid="issues-group-select"
        @update:model-value="selectGroup"
      />
      <button
        type="button"
        class="flex min-w-0 items-center gap-2 rounded-md text-left hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
        :aria-expanded="open"
        :aria-controls="contentId"
        data-testid="issues-group-toggle"
        @click="open = !open"
      >
        <UIcon
          name="i-lucide-chevron-right"
          class="size-4 shrink-0 text-muted transition-transform"
          :class="{ 'rotate-90': open }"
        />
        <span class="truncate font-medium text-highlighted" :title="title" data-testid="issues-group-title">{{ title }}</span>
      </button>
      <UTooltip v-if="epic" :text="epic.id">
        <button
          type="button"
          class="shrink-0 font-mono text-xs text-muted underline decoration-dotted underline-offset-2 hover:text-default"
          data-testid="issues-group-id"
          @click="emit('open', epic.id)"
        >
          {{ issuesShortId(epic.id) }}
        </button>
      </UTooltip>
      <span v-if="epic?.assignee" class="shrink-0 text-xs text-muted">({{ epic.assignee }})</span>
      <span class="shrink-0 text-xs text-muted" data-testid="issues-group-counts">{{ openCount }} open / {{ totalCount }} total</span>
    </div>

    <UCollapsible :id="contentId" v-model:open="open">
      <template #content>
        <div class="flex min-w-0 flex-col" :class="nested ? 'pl-1 sm:pl-2' : 'pr-2 pb-1 pl-2 sm:pl-6'">
          <p v-if="issues.length === 0 && epics.length === 0" class="px-2 py-1.5 text-sm text-muted">
            No issues in this group.
          </p>
          <IssuesRow
            v-for="issue in issues"
            :key="issue.id"
            :slug="slug"
            :issue="issue"
            :selected="selection.ids.value.has(issue.id)"
            @open="id => emit('open', id)"
            @toggle="selection.toggle"
          />
          <IssuesEpicGroup
            v-for="child in epics"
            :key="child.epic.id"
            :slug="slug"
            :group-key="child.epic.id"
            :title="child.epic.title"
            :epic="child.epic"
            :issues="child.issues"
            :epics="child.epics"
            :open-count="child.openCount"
            :total-count="child.totalCount"
            :depth="(depth ?? 0) + 1"
            @open="id => emit('open', id)"
          />
        </div>
      </template>
    </UCollapsible>
  </section>
</template>
