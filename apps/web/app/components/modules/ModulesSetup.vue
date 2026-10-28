<script setup lang="ts">
import type { RegistryResponse } from '@candy-mountain/shared'

const props = defineProps<{ registry: RegistryResponse }>()

const { modules, enabled, pluginTypes, instances, status, error, saving, setEnabled, refresh } = useModulesSetup()

const cards = computed(() => modules.value.map(mod => ({
  module: mod,
  enabled: enabled.value.includes(mod.id),
  reasons: props.registry.degraded.find(degraded => degraded.id === mod.id)?.reasons ?? [],
  plugins: modulePluginNeeds(mod, pluginTypes.value).map(need => ({ need, health: pluginHealth(need.typeId, pluginTypes.value, instances.value) })),
})))
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-6">
    <p class="text-sm text-muted">
      Enable a module to add its pages to {{ registry.project.name }}. A plugin configured once serves every module that needs it.
    </p>

    <UAlert
      v-if="status === 'error'"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Couldn't load modules"
      :description="toApiError(error).message"
      :actions="[{ label: 'Try again', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => { refresh() } }]"
    />
    <template v-else-if="status === 'pending' && !modules.length">
      <USkeleton v-for="n in 3" :key="n" class="h-48 w-full" />
    </template>
    <ModulesCard
      v-for="card in cards"
      v-else
      :key="card.module.id"
      :module="card.module"
      :enabled="card.enabled"
      :saving="saving === card.module.id"
      :disabled="saving !== null"
      :slug="registry.project.slug"
      :capabilities="registry.capabilities"
      :reasons="card.reasons"
      :plugins="card.plugins"
      @toggle="setEnabled(card.module.id, $event)"
    />
  </div>
</template>
