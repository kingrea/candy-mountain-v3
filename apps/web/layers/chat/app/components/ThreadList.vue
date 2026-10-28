<template>
  <div class="flex flex-col overflow-y-auto" data-testid="chat-thread-list">
    <UEmpty
      v-if="threads.length === 0"
      icon="i-lucide-messages-square"
      :title="status === 'pending' ? 'Loading threads' : 'No threads yet'"
      :description="status === 'pending' ? undefined : 'Start one and the first prompt becomes its title.'"
      :actions="status === 'pending' ? [] : [{ label: 'New thread', icon: 'i-lucide-plus', onClick: () => emit('create') }]"
      class="flex-1"
    />
    <ul v-else class="divide-y divide-default">
      <li v-for="thread in threads" :key="thread.id">
        <button
          type="button"
          class="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-elevated/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          :data-testid="`chat-thread-${thread.id}`"
          :data-unread="thread.unread || undefined"
          :data-working="thread.working || undefined"
          @click="emit('select', thread.id)"
        >
          <span class="mt-1.5 size-2 shrink-0 rounded-full" :class="thread.unread ? 'bg-error' : 'bg-transparent'" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm" :class="thread.unread ? 'font-semibold text-highlighted' : 'text-default'">
              {{ thread.title ?? 'Untitled thread' }}
            </span>
            <span class="block text-xs text-muted">{{ chatRelativeTime(thread.lastActivityAt) }}</span>
          </span>
          <UIcon v-if="thread.working" name="i-lucide-loader-circle" class="mt-1 size-4 shrink-0 animate-spin text-primary" aria-label="Working" />
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { ChatThread } from '@candy-mountain/shared'

defineProps<{
  threads: ChatThread[]
  status: 'idle' | 'pending' | 'success' | 'error'
}>()

const emit = defineEmits<{
  select: [threadId: string]
  create: []
}>()
</script>
