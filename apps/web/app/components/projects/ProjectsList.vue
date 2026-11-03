<script setup lang="ts">
import type { Workspace } from '@candy-mountain/shared'
import type { DropdownMenuItem } from '@nuxt/ui'

export interface ProjectGroup {
  id: string
  label: string
  projects: Workspace[]
}

defineProps<{
  groups: ProjectGroup[]
}>()

const emit = defineEmits<{
  edit: [project: Workspace]
  action: [action: ProjectRowAction, project: Workspace]
  archive: [project: Workspace]
  unarchive: [project: Workspace]
  delete: [project: Workspace]
}>()

const details = projectRowItems('detail')
const badges = projectRowItems('badges')
const rowActions = projectRowActions()

function actions(project: Workspace): DropdownMenuItem[][] {
  return [
    [
      { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => emit('edit', project) },
      ...rowActions.map(action => ({ label: action.label, icon: action.icon, onSelect: () => emit('action', action, project) })),
    ],
    [
      project.archived
        ? { label: 'Unarchive', icon: 'i-lucide-archive-restore', onSelect: () => emit('unarchive', project) }
        : { label: 'Archive', icon: 'i-lucide-archive', onSelect: () => emit('archive', project) },
      { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => emit('delete', project) },
    ],
  ]
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <section v-for="group in groups" :key="group.id" :data-group="group.id">
      <h2 class="mb-2 flex items-center gap-2 text-sm font-semibold text-highlighted">
        {{ group.label }}
        <UBadge :label="String(group.projects.length)" color="neutral" variant="soft" size="sm" />
      </h2>

      <ul class="divide-y divide-default rounded-md border border-default">
        <li
          v-for="project in group.projects"
          :key="project.id"
          class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
          :class="{ 'opacity-60': project.archived }"
          :data-project="project.slug"
        >
          <div class="flex min-w-0 flex-1 items-start gap-3">
            <span
              class="mt-1.5 size-3 shrink-0 rounded-full"
              :style="{ backgroundColor: project.color }"
              :title="project.color"
            />
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-x-2">
                <span class="font-medium text-highlighted">{{ project.name }}</span>
                <span class="font-mono text-xs text-muted">{{ project.slug }}</span>
                <UBadge
                  v-if="project.archived"
                  label="Archived"
                  icon="i-lucide-archive"
                  color="neutral"
                  variant="outline"
                  size="sm"
                />
              </div>
              <component :is="item.component" v-for="item in details" :key="item.id" :project="project" />
            </div>
          </div>

          <div class="flex items-center justify-between gap-2 pl-6 sm:pl-0">
            <component :is="item.component" v-for="item in badges" :key="item.id" :project="project" />
            <UDropdownMenu :items="actions(project)" :content="{ align: 'end' }">
              <UButton
                icon="i-lucide-ellipsis-vertical"
                color="neutral"
                variant="ghost"
                size="sm"
                :aria-label="`Actions for ${project.name}`"
              />
            </UDropdownMenu>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
