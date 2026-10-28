<script setup lang="ts">
import type { PluginInstance, PluginScope, PluginTypeInfo } from '@candy-mountain/shared'

const { project } = useSelectedProject()
const { registry } = useProjectRegistry()
const { types, status: typesStatus, error: typesError } = usePluginTypes()
const { instances, projectInstances, globalInstances, status, error } = usePlugins()
const toast = useToast()

const typeById = computed(() => new Map(types.value.map(type => [type.id, type])))
const neededBy = computed(() => pluginsNeededBy(registry.value))
// The daemon resolves a type to the project's own instance first, so only that one carries the readiness warning.
const resolvedIds = computed(() => new Set(types.value.flatMap((type) => {
  const resolved = projectInstances.value.find(i => i.type === type.id) ?? globalInstances.value.find(i => i.type === type.id)
  return resolved ? [resolved.id] : []
})))
const loading = computed(() => (status.value === 'pending' && !instances.value.length) || (typesStatus.value === 'pending' && !types.value.length))
const loadError = computed(() => error.value ?? typesError.value)

const groups = computed(() => [
  {
    id: 'project',
    title: project.value ? `${project.value.name} plugins` : 'Project plugins',
    description: 'Used by this project only, ahead of any platform-wide plugin of the same type.',
    empty: 'This project has no plugins of its own yet.',
    instances: projectInstances.value,
  },
  {
    id: 'global',
    title: 'Platform-wide plugins',
    description: 'Shared by every project that has no plugin of its own of that type.',
    empty: 'No platform-wide plugins.',
    instances: globalInstances.value,
  },
])

const form = reactive<{ open: boolean, type: PluginTypeInfo | null, instance: PluginInstance | null, scopes: PluginScope[] }>({
  open: false,
  type: null,
  instance: null,
  scopes: [],
})

function openCreate(type: PluginTypeInfo, scopes: PluginScope[]) {
  Object.assign(form, { type, instance: null, scopes, open: true })
}

function openEdit(instance: PluginInstance) {
  const type = typeById.value.get(instance.type)
  if (type) Object.assign(form, { type, instance, scopes: [instance.scope], open: true })
}

function onSaved(instance: PluginInstance, created: boolean) {
  const name = typeById.value.get(instance.type)?.name ?? instance.type
  toast.add({
    title: created ? `Added ${name}` : `Saved ${name}`,
    description: 'Run Test connection to check it works.',
    icon: 'i-lucide-plug',
  })
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Could not load plugins"
      :description="toApiError(loadError).message"
    />

    <div v-if="loading" class="flex flex-col gap-3">
      <USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
    </div>

    <template v-else>
      <section v-for="group in groups" :key="group.id" :data-group="group.id">
        <h2 class="text-sm font-semibold text-highlighted">
          {{ group.title }}
        </h2>
        <p class="mb-3 text-sm text-muted">
          {{ group.description }}
        </p>
        <div v-if="group.instances.length" class="flex flex-col gap-3">
          <PluginsInstanceCard
            v-for="instance in group.instances"
            :key="instance.id"
            :instance="instance"
            :type="typeById.get(instance.type)"
            :needed-by="resolvedIds.has(instance.id) ? neededBy[instance.type] : undefined"
            @edit="openEdit"
          />
        </div>
        <p v-else class="rounded-md border border-dashed border-default px-4 py-3 text-sm text-muted">
          {{ group.empty }}
        </p>
      </section>

      <section data-group="catalog">
        <h2 class="text-sm font-semibold text-highlighted">
          Add a plugin
        </h2>
        <p class="mb-3 text-sm text-muted">
          Each plugin says what Candy Mountain can do with it before you add it.
        </p>
        <PluginsCatalog :types="types" :instances="instances" :needed-by="neededBy" @add="openCreate" />
      </section>
    </template>

    <PluginsFormModal
      v-model:open="form.open"
      :type="form.type"
      :instance="form.instance"
      :scopes="form.scopes"
      @saved="onSaved"
    />
  </div>
</template>
