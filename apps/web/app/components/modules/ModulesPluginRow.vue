<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

const props = defineProps<{ need: ModulePluginNeed, health: PluginHealthSummary, configureTo: string }>()

const BADGES: Record<PluginHealthState, BadgeProps> = {
  'healthy': { label: 'Healthy', color: 'success', icon: 'i-lucide-circle-check' },
  'unhealthy': { label: 'Unhealthy', color: 'error', icon: 'i-lucide-circle-x' },
  'untested': { label: 'Untested', color: 'warning', icon: 'i-lucide-circle-help' },
  'secrets-missing': { label: 'Secrets missing', color: 'warning', icon: 'i-lucide-key-round' },
  'missing': { label: 'Not configured', color: 'neutral', icon: 'i-lucide-circle-dashed' },
}

const badge = computed(() => BADGES[props.health.state])
const source = computed(() => {
  if (props.health.scope === 'project') return 'Project instance'
  if (props.health.scope === 'global') return 'Platform instance'
  return null
})
</script>

<template>
  <li class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3" :data-testid="`module-plugin-${need.typeId}`">
    <div class="min-w-0 flex-1 basis-48">
      <p class="text-sm font-medium text-highlighted">
        {{ need.name }}
        <span v-if="need.alternatives.length" class="font-normal text-muted">or {{ need.alternatives.join(', ') }}</span>
      </p>
      <p class="text-xs text-muted">
        Needed by {{ need.neededBy.join(', ') }}<template v-if="source">
          · {{ source }}
        </template>
      </p>
    </div>
    <div class="flex items-center gap-2">
      <UTooltip :text="health.detail" :ui="{ content: 'h-auto max-w-72 py-1.5 whitespace-normal' }">
        <UBadge v-bind="badge" variant="subtle" :data-health="health.state" data-testid="module-plugin-health" />
      </UTooltip>
      <UButton
        label="Configure"
        icon="i-lucide-settings-2"
        size="xs"
        color="neutral"
        variant="outline"
        :to="configureTo"
        :aria-label="`Configure ${need.name}`"
        data-testid="module-plugin-configure"
      />
    </div>
  </li>
</template>
