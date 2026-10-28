<template>
  <UButton
    v-if="status === 'success' && items.length === 0"
    :to="PROJECTS_PAGE_PATH"
    icon="i-lucide-plus"
    color="neutral"
    variant="ghost"
    label="Add a project"
  />
  <USelectMenu
    v-else
    :model-value="slug ?? undefined"
    :items="items"
    value-key="value"
    :search-input="searchable ? { placeholder: 'Search projects…' } : false"
    placeholder="Select a project"
    color="neutral"
    variant="ghost"
    :loading="status === 'pending'"
    aria-label="Project"
    class="w-full max-w-64"
    :ui="{ content: 'min-w-64 max-h-[min(28rem,var(--reka-combobox-content-available-height,28rem))]' }"
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
          label="Manage projects"
          block
          class="justify-start"
        />
      </div>
    </template>
  </USelectMenu>
</template>

<script setup lang="ts">
const { slug, project, groups, status, refresh, select } = useSelectedProject()

const items = computed(() => projectPickerItems(groups.value))
const searchable = computed(() =>
  groups.value.reduce((count, group) => count + group.projects.length, 0) > PROJECT_PICKER_SEARCH_THRESHOLD,
)

// Projects can be added or archived elsewhere, so the list is refreshed whenever the menu opens.
function onOpen(open: boolean) {
  if (open) refresh()
}

function onSelect(value: unknown) {
  if (typeof value === 'string' && value !== slug.value) select(value)
}
</script>
