<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

defineProps<{ collapsed?: boolean }>()

const { capabilityGroups, systemGroup } = useNavigation()

function toItems(group: NavGroup): NavigationMenuItem[] {
  return group.entries.map(entry => ({
    label: entry.label,
    icon: entry.icon,
    to: entry.to,
    exact: entry.exact,
    ...(entry.locked ? { slot: 'locked', warning: group.warning } : {}),
  }))
}

function labelItem(group: NavGroup): NavigationMenuItem {
  return { label: group.label, type: 'label' }
}

// Nuxt UI types a custom slot's item as never when the slot name is not a literal.
const warningOf = (item: unknown) => (item as { warning?: string }).warning

const capabilityItems = computed(() => capabilityGroups.value.map(group => [labelItem(group), ...toItems(group)]))
const systemItems = computed(() => [labelItem(systemGroup.value), ...toItems(systemGroup.value)])
</script>

<template>
  <UNavigationMenu
    v-if="capabilityItems.length"
    :collapsed="collapsed"
    :items="capabilityItems"
    orientation="vertical"
    tooltip
  >
    <template #locked-trailing="{ item }">
      <UTooltip v-if="warningOf(item)" :ui="{ content: 'h-auto max-w-72 py-1.5' }">
        <template #content>
          <p class="whitespace-normal">
            {{ warningOf(item) }}
          </p>
        </template>
        <UIcon name="i-lucide-triangle-alert" class="size-4 text-warning" aria-label="Needs setup" data-testid="nav-locked" />
      </UTooltip>
      <UIcon v-else name="i-lucide-triangle-alert" class="size-4 text-warning" aria-label="Needs setup" data-testid="nav-locked" />
    </template>
  </UNavigationMenu>
  <UNavigationMenu
    :collapsed="collapsed"
    :items="systemItems"
    orientation="vertical"
    tooltip
    class="mt-auto"
  />
</template>
