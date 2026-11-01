<script setup lang="ts">
import type { ButtonProps } from '@nuxt/ui'
import type { ModuleInfo, ReadinessReason, RegistryCapability } from '@candy-mountain/shared'

const props = defineProps<{
  module: ModuleInfo
  enabled: boolean
  saving: boolean
  disabled: boolean
  slug: string
  /** The registry's view of each member; absent while the module is disabled. */
  capabilities: readonly RegistryCapability[]
  reasons: readonly ReadinessReason[]
  plugins: readonly { need: ModulePluginNeed, health: PluginHealthSummary }[]
}>()

const emit = defineEmits<{ toggle: [on: boolean] }>()

const messages = computed(() => [...new Set(props.reasons.map(reason => reason.message))])
const actions = computed<ButtonProps[]>(() =>
  lockoutActions(props.reasons, props.slug).map(action => ({ ...action, size: 'xs', color: 'warning', variant: 'outline' })),
)
const pluginsTo = computed(() => projectPluginsPagePath(props.slug))

function readiness(capabilityId: string) {
  if (!props.enabled) return null
  const capability = props.capabilities.find(candidate => candidate.id === capabilityId)
  if (!capability) return null
  return capability.ready
    ? { label: 'Ready', color: 'success' as const }
    : { label: 'Needs setup', color: 'warning' as const }
}
</script>

<template>
  <UCard :data-testid="`module-${module.id}`" :data-enabled="enabled">
    <template #header>
      <div class="flex items-start gap-3">
        <UIcon :name="module.icon" class="mt-0.5 size-5 shrink-0 text-primary" />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="font-semibold text-highlighted">
              {{ module.label }}
            </h2>
            <UBadge v-if="enabled" label="Enabled" color="success" variant="subtle" size="sm" />
          </div>
          <p class="text-sm text-muted">
            {{ module.description }}
          </p>
        </div>
        <USwitch
          :model-value="enabled"
          :loading="saving"
          :disabled="disabled"
          :aria-label="`${enabled ? 'Disable' : 'Enable'} ${module.label}`"
          data-testid="module-toggle"
          @update:model-value="emit('toggle', $event)"
        />
      </div>
    </template>

    <div class="flex flex-col gap-5">
      <UAlert
        v-if="enabled && messages.length"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="`Needs setup for this ${SCOPE.singular}`"
        :actions="actions"
        data-testid="module-degraded"
      >
        <template #description>
          <ul class="list-inside list-disc">
            <li v-for="message in messages" :key="message">
              {{ message }}
            </li>
          </ul>
        </template>
      </UAlert>

      <section>
        <h3 class="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
          Capabilities
        </h3>
        <p v-if="!module.capabilities.length" class="text-sm text-muted">
          Nothing in this module yet, so enabling it adds no pages for now.
        </p>
        <ul v-else class="divide-y divide-default">
          <li v-for="capability in module.capabilities" :key="capability.capabilityId" class="flex items-start justify-between gap-3 py-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-highlighted">
                {{ capability.label }}
              </p>
              <p class="text-sm text-muted">
                {{ capability.description }}
              </p>
            </div>
            <UBadge v-if="readiness(capability.capabilityId)" v-bind="readiness(capability.capabilityId)!" variant="subtle" size="sm" class="shrink-0" />
          </li>
        </ul>
      </section>

      <section>
        <h3 class="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
          Plugins
        </h3>
        <p v-if="!plugins.length" class="text-sm text-muted">
          Needs no plugins.
        </p>
        <ul v-else class="divide-y divide-default">
          <ModulesPluginRow
            v-for="plugin in plugins"
            :key="plugin.need.typeId"
            :need="plugin.need"
            :health="plugin.health"
            :configure-to="pluginsTo"
          />
        </ul>
      </section>
    </div>
  </UCard>
</template>
