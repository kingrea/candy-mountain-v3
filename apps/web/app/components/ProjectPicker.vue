<template>
  <UTooltip
    v-if="status === 'success' && items.length === 0"
    :text="addLabel"
    :disabled="!collapsed"
    :content="{ side: 'right' }"
  >
    <UButton
      :to="PROJECTS_PAGE_PATH"
      icon="i-lucide-plus"
      color="neutral"
      variant="ghost"
      :label="collapsed ? undefined : addLabel"
      :aria-label="collapsed ? addLabel : undefined"
      :class="collapsed ? 'h-8 w-full justify-center' : 'w-full justify-start'"
    />
  </UTooltip>
  <UTooltip
    v-else
    :text="project?.name ?? selectLabel"
    :disabled="!collapsed"
    :content="{ side: 'right' }"
  >
    <USelectMenu
      :model-value="slug ?? undefined"
      :items="items"
      value-key="value"
      :search-input="searchable ? { placeholder: `Search ${SCOPE.plural}…` } : false"
      :placeholder="selectLabel"
      color="neutral"
      variant="ghost"
      :loading="status === 'pending'"
      :aria-label="SCOPE.singularTitle"
      :class="collapsed ? 'h-8 w-full' : 'w-full'"
      :ui="collapsed ? collapsedUi : expandedUi"
      @update:open="onOpen"
      @update:model-value="onSelect"
    >
      <template #leading>
        <ProjectColorDot v-if="project" :color="project.color" />
        <UIcon v-else name="i-lucide-folder-git-2" class="size-5 text-dimmed" />
      </template>

      <template #item-leading="{ item }">
        <span v-if="item.type === 'item'" class="flex size-5 shrink-0 items-center justify-center">
          <ProjectColorDot :color="item.color" />
        </span>
      </template>

      <template #content-bottom>
        <div class="border-t border-default p-1">
          <UButton
            :to="PROJECTS_PAGE_PATH"
            icon="i-lucide-folder-cog"
            color="neutral"
            variant="ghost"
            size="sm"
            :label="`Manage ${SCOPE.plural}`"
            block
            class="justify-start"
          />
        </div>
      </template>
    </USelectMenu>
  </UTooltip>
</template>

<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()

// Shows the last opened project on system pages too, so the picker agrees with the side menu.
const { slug, routeSlug, project, groups, status, refresh, select } = useNavigationProject()

const addLabel = `Add ${SCOPE.aSingular}`
const selectLabel = `Select ${SCOPE.aSingular}`

const items = computed(() => projectPickerItems(groups.value))
const searchable = computed(() =>
  groups.value.reduce((count, group) => count + group.projects.length, 0) > PROJECT_PICKER_SEARCH_THRESHOLD,
)

// The menu opens from a narrow trigger in the sidebar, so it gets its own width instead of the trigger's.
const content = 'min-w-64 max-h-[min(28rem,var(--reka-combobox-content-available-height,28rem))]'
const expandedUi = { content }
// Collapsed sidebar: only the colour dot shows, centred like the collapsed nav icons.
const collapsedUi = {
  content,
  base: 'h-8 w-full justify-center p-0',
  leading: 'static',
  value: 'hidden',
  placeholder: 'hidden',
  trailing: 'hidden',
}

// Projects can be added or archived elsewhere, so the list is refreshed whenever the menu opens.
function onOpen(open: boolean) {
  if (open) refresh()
}

function onSelect(value: unknown) {
  if (typeof value === 'string' && value !== routeSlug.value) select(value)
}
</script>
