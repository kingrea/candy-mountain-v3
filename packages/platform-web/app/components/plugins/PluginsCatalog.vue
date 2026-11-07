<script setup lang="ts">
import type { PluginInstance, PluginScope, PluginTypeInfo } from '@candy-mountain/platform-sdk'

const props = defineProps<{
  types: PluginTypeInfo[]
  instances: PluginInstance[]
  neededBy: Record<string, string[]>
}>()

const emit = defineEmits<{
  add: [type: PluginTypeInfo, scopes: PluginScope[]]
}>()

const entries = computed(() => props.types.map(type => ({
  type,
  scopes: availablePluginScopes(type, props.instances),
  // An added type's warning moves to its instance card, next to the health that explains it.
  neededBy: props.instances.some(instance => instance.type === type.id) ? [] : props.neededBy[type.id] ?? [],
})))
</script>

<template>
  <ul class="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
    <li v-for="entry in entries" :key="entry.type.id" :data-plugin-type="entry.type.id">
      <component
        :is="entry.scopes.length ? 'button' : 'div'"
        :type="entry.scopes.length ? 'button' : undefined"
        class="flex h-full w-full flex-col gap-3 rounded-md border border-default bg-default p-4 text-left"
        :class="entry.scopes.length && 'cursor-pointer transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'"
        :data-testid="entry.scopes.length ? 'plugin-add' : undefined"
        @click="entry.scopes.length && emit('add', entry.type, entry.scopes)"
      >
        <div class="flex items-start gap-3">
          <PluginsIcon :type="entry.type.id" class="mt-0.5" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-highlighted">{{ entry.type.name }}</span>
              <UBadge
                v-for="scope in entry.type.scopes"
                :key="scope"
                :label="PLUGIN_SCOPE_LABELS[scope]"
                color="neutral"
                variant="outline"
                size="sm"
              />
            </div>
            <p class="mt-0.5 text-sm text-muted">
              {{ entry.type.description }}
            </p>
          </div>
        </div>

        <PluginsReach :reach="entry.type.reach" />

        <div class="mt-auto flex flex-wrap items-center justify-between gap-2">
          <UBadge
            v-if="entry.neededBy.length"
            :label="`Needed by ${entry.neededBy.join(', ')}`"
            icon="i-lucide-triangle-alert"
            color="warning"
            variant="subtle"
            size="sm"
            class="max-w-full"
            data-testid="plugin-needed"
          />
          <span v-else />
          <span v-if="entry.scopes.length" class="inline-flex items-center gap-1 text-sm font-medium text-primary">
            <UIcon name="i-lucide-plus" class="size-4" />
            Add
          </span>
          <UBadge v-else label="Added" icon="i-lucide-check" color="neutral" variant="soft" />
        </div>
      </component>
    </li>
  </ul>
</template>
