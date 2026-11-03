<template>
  <aside
    v-if="entries.length"
    aria-label="Chat"
    data-testid="chat-rail"
    class="flex w-12 shrink-0 flex-col items-center gap-1 border-l border-default bg-elevated/50 py-2"
  >
    <UDropdownMenu :items="newItems" :content="{ side: 'left', align: 'start' }">
      <UButton
        icon="i-lucide-plus"
        color="neutral"
        variant="ghost"
        aria-label="Start a thread"
        data-testid="chat-rail-new"
      />
    </UDropdownMenu>

    <USeparator class="my-1 w-8" />

    <UTooltip v-for="entry in entries" :key="entry.id" :text="entryTitle(entry)" :content="{ side: 'left' }">
      <UChip
        :show="Boolean(entry.unread || entry.working)"
        :color="entry.working ? 'primary' : 'error'"
        inset
        :data-working="entry.working || undefined"
        :data-unread="entry.unread || undefined"
      >
        <UButton
          :icon="entry.avatar"
          color="neutral"
          :variant="isActive(entry) ? 'soft' : 'ghost'"
          :aria-label="entryTitle(entry)"
          :aria-pressed="isActive(entry)"
          :data-testid="`chat-rail-entry-${entry.id}`"
          @click="toggle(entry)"
        />
      </UChip>
    </UTooltip>
  </aside>
</template>

<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { state, open, openEntry, startThread, close } = useChatPanel()

const props = defineProps<{ entries: ChatRailEntry[] }>()
const newItems = computed<DropdownMenuItem[]>(() => props.entries.map(entry => ({
  label: entry.label,
  icon: entry.avatar,
  onSelect: () => startThread(entry.id),
})))

const isActive = (entry: ChatRailEntry) => open.value && state.value.entryId === entry.id

function entryTitle(entry: ChatRailEntry) {
  if (entry.working) return `${entry.label} (working)`
  if (entry.unread) return `${entry.label} (unread)`
  return entry.label
}

function toggle(entry: ChatRailEntry) {
  if (isActive(entry)) close()
  else openEntry(entry.id)
}
</script>
