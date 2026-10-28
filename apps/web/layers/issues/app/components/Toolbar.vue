<script setup lang="ts">
import type { IssuesStateFilter } from '#layers/issues/app/utils/issues-list'

const props = defineProps<{ slug: string }>()

const { showClosed, stateFilter, search } = useIssuesListState(props.slug)

const stateOptions: { value: Exclude<IssuesStateFilter, null>, label: string, icon: string }[] = [
  { value: 'ready', label: 'Ready', icon: 'i-lucide-zap' },
  { value: 'blocked', label: 'Blocked', icon: 'i-lucide-ban' },
]

function toggleState(value: Exclude<IssuesStateFilter, null>) {
  stateFilter.value = stateFilter.value === value ? null : value
}
</script>

<template>
  <div class="flex w-full flex-wrap items-center gap-3 py-2">
    <UInput
      v-model="search"
      icon="i-lucide-search"
      placeholder="Search title or id"
      aria-label="Search issues by title or id"
      class="w-full sm:w-72"
      data-testid="issues-search"
    >
      <template v-if="search" #trailing>
        <UButton icon="i-lucide-x" color="neutral" variant="link" size="sm" aria-label="Clear search" @click="search = ''" />
      </template>
    </UInput>

    <UFieldGroup>
      <UButton
        v-for="option in stateOptions"
        :key="option.value"
        :label="option.label"
        :icon="option.icon"
        color="neutral"
        :variant="stateFilter === option.value ? 'solid' : 'outline'"
        :aria-pressed="stateFilter === option.value"
        :data-testid="`issues-filter-${option.value}`"
        @click="toggleState(option.value)"
      />
    </UFieldGroup>

    <USwitch v-model="showClosed" label="Show closed" data-testid="issues-show-closed" />
  </div>
</template>
