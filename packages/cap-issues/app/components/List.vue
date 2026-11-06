<script setup lang="ts">
const props = defineProps<{ slug: string }>()

const emit = defineEmits<{ open: [id: string] }>()

const { issues, status, error, refresh } = useIssuesList(props.slug)
const view = useIssuesListState(props.slug)

const blockedIds = computed(() => issuesBlockedIds(issues.value))
const tree = computed(() => issuesGroupTree(issues.value, { showClosed: view.showClosed.value }))
const visible = computed(() => issuesFilterTree(tree.value, view.filters.value, blockedIds.value))
const filtering = computed(() => issuesFiltersActive(view.filters.value))
const empty = computed(() => visible.value.groups.length === 0 && visible.value.ungrouped === null)
const loadError = computed(() => (error.value ? toApiError(error.value) : null))

function clearFilters() {
  view.stateFilter.value = null
  view.search.value = ''
}

defineExpose({ refresh })
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="issues-list">
    <UEmpty
      v-if="loadError && issues.length === 0"
      icon="i-lucide-circle-x"
      title="Couldn't load issues"
      :description="loadError.message"
      :actions="[{ label: 'Try again', icon: 'i-lucide-refresh-cw', onClick: () => refresh() }]"
      data-testid="issues-error"
    />
    <template v-else-if="status === 'pending' && issues.length === 0">
      <USkeleton v-for="index in 4" :key="index" class="h-24 w-full" />
    </template>
    <UEmpty
      v-else-if="empty && filtering"
      icon="i-lucide-search-x"
      title="No matching issues"
      description="Nothing matches the current search and filters."
      :actions="[{ label: 'Clear filters', icon: 'i-lucide-x', color: 'neutral', variant: 'outline', onClick: clearFilters }]"
      data-testid="issues-no-match"
    />
    <UEmpty
      v-else-if="empty"
      icon="i-lucide-list-todo"
      title="No issues"
      :description="issues.length === 0 ? 'This project has no issues yet.' : 'Every issue is closed. Turn on Show closed to see them.'"
      data-testid="issues-empty"
    />
    <template v-else>
      <IssuesEpicGroup
        v-for="node in visible.groups"
        :key="node.epic.id"
        :slug="slug"
        :group-key="node.epic.id"
        :title="node.epic.title"
        :epic="node.epic"
        :issues="node.issues"
        :epics="node.epics"
        :open-count="node.openCount"
        :total-count="node.totalCount"
        @open="id => emit('open', id)"
      />
      <IssuesEpicGroup
        v-if="visible.ungrouped"
        :slug="slug"
        :group-key="ISSUES_UNGROUPED_KEY"
        title="No epic"
        :epic="null"
        :issues="visible.ungrouped.issues"
        :epics="[]"
        :open-count="visible.ungrouped.openCount"
        :total-count="visible.ungrouped.totalCount"
        @open="id => emit('open', id)"
      />
    </template>
  </div>
</template>
