<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-2">
        <h2 class="font-semibold text-highlighted">
          Plugins
        </h2>
        <UButton v-if="admin && slug" label="Manage" variant="link" size="sm" :to="projectPluginsPagePath(slug)" />
      </div>
    </template>

    <p v-if="!admin" class="text-sm text-muted">
      Only an admin can see the project's plugins.
    </p>
    <p v-else-if="error" class="text-sm text-error">
      Couldn't load the project's plugins.
    </p>
    <ul v-else-if="instances.length" class="flex flex-col gap-3" data-testid="overview-plugins">
      <li v-for="instance in instances" :key="instance.id" class="flex flex-col gap-1 text-sm">
        <div class="flex items-center justify-between gap-2">
          <span class="flex min-w-0 items-center gap-2 font-medium text-highlighted">
            <PluginsIcon :type="instance.type" />
            <span>
              {{ typeNames.get(instance.type) ?? instance.type }}
              <span v-if="instance.scope === 'global'" class="font-normal text-muted">(global)</span>
            </span>
          </span>
          <UBadge v-bind="healthBadge(instance)" variant="subtle" />
        </div>
        <p v-if="instance.health && !instance.health.healthy" class="text-muted">
          {{ instance.health.reason }}
        </p>
        <p v-if="instance.health" class="text-xs text-dimmed">
          Checked <NuxtTime :datetime="instance.health.checkedAt" relative />
        </p>
      </li>
    </ul>
    <p v-else-if="status === 'success'" class="text-sm text-muted">
      No plugins are configured for this project.
    </p>
  </UCard>
</template>

<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'
import { PLUGIN_TYPES_PATH, PLUGINS_PATH, type PluginInstance, type PluginInstanceListResponse, type PluginTypeListResponse } from '@candy-mountain/shared'

const { slug } = useSelectedProject()
const { registry } = useProjectRegistry()

// The plugin routes are admin only because instances carry credentials.
const admin = computed(() => registry.value?.admin === true)

const { data, status, error } = useApi<PluginInstanceListResponse>(PLUGINS_PATH, {
  query: { project: slug },
  immediate: admin.value,
  watch: [admin],
})
const { data: types } = useApi<PluginTypeListResponse>(PLUGIN_TYPES_PATH)

const instances = computed(() => (admin.value ? data.value?.instances ?? [] : []))
const typeNames = computed(() => new Map((types.value?.types ?? []).map(type => [type.id, type.name])))

function healthBadge(instance: PluginInstance): BadgeProps {
  if (!instance.health) return { color: 'neutral', label: 'Untested' }
  return instance.health.healthy ? { color: 'success', label: 'Healthy' } : { color: 'error', label: 'Unhealthy' }
}
</script>
