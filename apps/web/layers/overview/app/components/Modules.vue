<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-semibold text-highlighted">
          Modules
        </h2>
        <UButton v-if="registry?.admin && slug" label="Manage" variant="link" size="sm" :to="projectModulesPagePath(slug)" />
      </div>
    </template>

    <ul v-if="modules.length" class="flex flex-col gap-3" data-testid="overview-modules">
      <li v-for="mod in modules" :key="mod.id" class="flex items-start gap-2 text-sm">
        <UIcon :name="mod.icon" class="mt-0.5 size-4 shrink-0 text-muted" />
        <div class="min-w-0">
          <p class="font-medium text-highlighted">
            {{ mod.label }}
          </p>
          <p v-if="mod.entries.length" class="flex flex-wrap gap-x-3">
            <ULink v-for="entry in mod.entries" :key="entry.id" :to="entry.to" class="text-muted hover:text-default">
              {{ entry.label }}
            </ULink>
          </p>
        </div>
      </li>
    </ul>
    <p v-else class="text-sm text-muted">
      No modules are enabled for this project.
    </p>
  </UCard>
</template>

<script setup lang="ts">
const { slug } = useSelectedProject()
const { registry } = useProjectRegistry()

// The registry only has groups for modules with something to show, so an empty module falls back to its id.
const modules = computed(() => (registry.value?.modules ?? []).map((id) => {
  const group = registry.value?.groups.find(g => g.kind === 'module' && g.id === id)
  return {
    id,
    label: group?.label ?? id.split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join(' '),
    icon: group?.icon ?? 'i-lucide-blocks',
    entries: group?.entries ?? [],
  }
}))
</script>
