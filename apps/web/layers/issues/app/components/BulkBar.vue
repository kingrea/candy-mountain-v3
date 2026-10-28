<script setup lang="ts">
import { ISSUE_TITLE_MAX_LENGTH, MAX_BULK_ISSUE_IDS, type Issue } from '@candy-mountain/shared'

const props = defineProps<{ slug: string }>()

defineSlots<{
  run?: (props: { ids: readonly string[], count: number, clear: () => void }) => unknown
}>()

const selection = useIssuesSelection(props.slug)
const bulk = useIssuesBulk(props.slug)
const { data: issues } = useNuxtData<Issue[]>(issuesListKey(props.slug))

const count = selection.count
const ids = computed(() => [...selection.ids.value])
const tooMany = computed(() => issuesBulkTooMany(count.value))
const busy = computed(() => bulk.pending.value !== null)
const locked = computed(() => busy.value || tooMany.value)

const epicItems = computed(() => issuesBulkEpicItems(issues.value ?? [], selection.ids.value))
const statusItems = issuesBulkStatusItems()
const hasParent = computed(() => issuesSelectionHasParent(selection.ids.value, issues.value ?? []))
const pickerFilterFields = ['label', 'value']
const pickerUi = { placeholder: 'text-default', leadingIcon: 'text-default' }

// Pickers keep their last pick internally, so a failed action remounts them empty.
const resetKey = ref(0)
const assignOpen = ref(false)
const assignDraft = ref<string | null>(null)
const epicOpen = ref(false)
const epicTitle = ref('')

watch(issues, (current) => {
  if (!current || current.length === 0) return
  const kept = issuesPrunedSelection(selection.ids.value, current)
  if (kept) selection.set(kept)
})

function done(ok: boolean) {
  resetKey.value++
  if (ok) {
    assignOpen.value = false
    epicOpen.value = false
    epicTitle.value = ''
  }
}

async function addToEpic(epicId: string | undefined) {
  if (!epicId) return
  done(await bulk.apply('add-to-epic', { parentId: epicId }, epicId))
}

async function removeFromEpic() {
  done(await bulk.apply('remove-from-epic', { parentId: null }))
}

async function setStatus(status: string | undefined) {
  if (!status) return
  done(await bulk.apply('status', { status }, issuesStatusMeta(status).label))
}

async function assign(name: string | null) {
  assignDraft.value = null
  done(await bulk.apply('assign', { assignee: name }, name))
}

watch(assignDraft, (name) => {
  if (name) void assign(name)
})

async function createEpic() {
  if (epicTitle.value.trim() === '') return
  done(await bulk.createEpic(epicTitle.value))
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-150 ease-out"
    enter-from-class="translate-y-2 opacity-0"
    leave-active-class="transition duration-100 ease-in"
    leave-to-class="translate-y-2 opacity-0"
  >
    <div
      v-if="count > 0"
      class="sticky bottom-0 z-10 mt-auto flex justify-center"
      data-testid="issues-bulk-bar"
    >
      <div
        role="toolbar"
        aria-label="Bulk actions"
        class="flex max-w-full flex-wrap items-center gap-1.5 rounded-lg border border-default bg-default/95 p-1.5 shadow-lg backdrop-blur"
      >
        <span class="px-2 text-sm font-medium text-highlighted tabular-nums" aria-live="polite" data-testid="issues-bulk-count">
          {{ count }} selected
        </span>
        <span v-if="tooMany" class="px-1 text-xs text-error">Select at most {{ MAX_BULK_ISSUE_IDS }}</span>

        <USeparator orientation="vertical" class="h-5" />

        <slot name="run" :ids="ids" :count="count" :clear="selection.clear">
          <IssuesRunButton :slug="slug" :ids="ids" size="sm" variant="ghost" testid="issues-bulk-run" @started="selection.clear()" />
        </slot>

        <USelectMenu
          :key="`epic-${resetKey}`"
          :items="epicItems"
          value-key="value"
          :filter-fields="pickerFilterFields"
          :search-input="{ placeholder: 'Search epics by title or id' }"
          placeholder="Add to epic"
          icon="i-lucide-folder-input"
          size="sm"
          variant="ghost"
          :disabled="locked"
          :loading="bulk.pending.value === 'add-to-epic'"
          :content="{ align: 'start' }"
          :ui="{ ...pickerUi, content: 'min-w-72' }"
          virtualize
          aria-label="Add to epic"
          data-testid="issues-bulk-add-epic"
          @update:model-value="addToEpic"
        />

        <UPopover v-model:open="epicOpen">
          <UButton
            label="New epic"
            icon="i-lucide-folder-plus"
            size="sm"
            color="neutral"
            variant="ghost"
            :disabled="locked"
            :loading="bulk.pending.value === 'new-epic'"
            data-testid="issues-bulk-new-epic"
          />
          <template #content>
            <form class="flex w-72 flex-col gap-2 p-3" data-testid="issues-bulk-new-epic-form" @submit.prevent="createEpic">
              <UInput
                v-model="epicTitle"
                placeholder="Epic title"
                aria-label="New epic title"
                autofocus
                :maxlength="ISSUE_TITLE_MAX_LENGTH"
                data-testid="issues-bulk-new-epic-title"
              />
              <UButton
                type="submit"
                :label="`Create and move ${count}`"
                size="sm"
                block
                :disabled="epicTitle.trim() === '' || locked"
                :loading="bulk.pending.value === 'new-epic'"
                data-testid="issues-bulk-new-epic-submit"
              />
            </form>
          </template>
        </UPopover>

        <UButton
          label="Remove from epic"
          icon="i-lucide-folder-minus"
          size="sm"
          color="neutral"
          variant="ghost"
          :disabled="locked || !hasParent"
          :loading="bulk.pending.value === 'remove-from-epic'"
          data-testid="issues-bulk-remove-epic"
          @click="removeFromEpic"
        />

        <UPopover v-model:open="assignOpen">
          <UButton
            label="Assign"
            icon="i-lucide-user-round"
            size="sm"
            color="neutral"
            variant="ghost"
            :disabled="locked"
            :loading="bulk.pending.value === 'assign'"
            data-testid="issues-bulk-assign"
          />
          <template #content>
            <div class="flex w-64 flex-col gap-2 p-3" data-testid="issues-bulk-assign-panel">
              <IssuesAssigneePicker :key="`assign-${resetKey}`" v-model="assignDraft" :slug="slug" placeholder="Pick a name" :disabled="locked" />
              <UButton
                label="Unassign"
                icon="i-lucide-user-x"
                size="sm"
                color="neutral"
                variant="outline"
                block
                :disabled="locked"
                data-testid="issues-bulk-unassign"
                @click="assign(null)"
              />
            </div>
          </template>
        </UPopover>

        <USelect
          :key="`status-${resetKey}`"
          :items="statusItems"
          placeholder="Status"
          icon="i-lucide-circle-dot"
          size="sm"
          variant="ghost"
          :disabled="locked"
          :loading="bulk.pending.value === 'status'"
          :content="{ align: 'start' }"
          :ui="{ ...pickerUi, content: 'min-w-40' }"
          aria-label="Change status"
          data-testid="issues-bulk-status"
          @update:model-value="setStatus"
        />

        <USeparator orientation="vertical" class="h-5" />

        <UButton
          label="Clear"
          icon="i-lucide-x"
          size="sm"
          color="neutral"
          variant="ghost"
          :disabled="busy"
          data-testid="issues-bulk-clear"
          @click="selection.clear()"
        />
      </div>
    </div>
  </Transition>
</template>
