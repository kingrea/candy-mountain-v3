<template>
  <div>
    <UEmpty
      v-if="error"
      icon="i-lucide-circle-x"
      title="Couldn't load activity"
      :actions="[{ label: 'Try again', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => refresh() }]"
    />
    <UEmpty
      v-else-if="status === 'success' && !events.length"
      icon="i-lucide-history"
      title="No activity found"
      description="Nothing matches these filters yet."
      data-testid="activity-empty"
    />
    <ul v-else class="divide-y divide-default rounded-lg border border-default" data-testid="activity-feed">
      <li v-for="event in events" :key="event.id" class="flex items-start gap-3 px-4 py-3">
        <UIcon :name="kind(event).icon" class="mt-0.5 size-4 shrink-0 text-muted" />
        <div class="min-w-0 flex-1">
          <component
            :is="event.link ? NuxtLink : 'p'"
            :to="event.link ?? undefined"
            class="text-sm text-highlighted"
            :class="event.link ? 'hover:underline' : ''"
            data-testid="activity-event"
          >
            {{ event.title }}
          </component>
          <p class="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <NuxtLink :to="projectPath(event.workspace.slug)" class="inline-flex items-center gap-1.5 hover:underline" data-testid="activity-project">
              <ProjectColorDot :color="event.workspace.color" />
              {{ event.workspace.name }}
            </NuxtLink>
            · {{ kind(event).label }} · <NuxtTime :datetime="event.occurredAt" relative />
          </p>
        </div>
      </li>
    </ul>

    <div v-if="cursor" class="mt-4">
      <UButton label="Show older" color="neutral" variant="outline" size="sm" :loading="loadingOlder" @click="loadOlder" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ACTIVITY_PATH, type ActivityEventType, type CrossWorkspaceActivityEvent, type CrossWorkspaceActivityResponse } from '@candy-mountain/platform-sdk'
import { NuxtLink } from '#components'

const props = defineProps<{ type?: ActivityEventType, since?: string }>()

const { $api } = useNuxtApp()
const toast = useToast()

const query = computed(() => ({ type: props.type, since: props.since }))
const { data, status, error, refresh } = useApi<CrossWorkspaceActivityResponse>(ACTIVITY_PATH, { query })

const older = ref<CrossWorkspaceActivityEvent[]>([])
const olderCursor = ref<string | null>()
const loadingOlder = ref(false)

watch(data, () => {
  older.value = []
  olderCursor.value = undefined
})

const events = computed(() => [...(data.value?.events ?? []), ...older.value])
const cursor = computed(() => (olderCursor.value === undefined ? data.value?.nextCursor ?? null : olderCursor.value))

const activityTypes = useActivityTypes()
const kind = (event: CrossWorkspaceActivityEvent) => activityTypes.kind(event.type)

async function loadOlder() {
  if (!cursor.value) return
  loadingOlder.value = true
  try {
    const page = await $api<CrossWorkspaceActivityResponse>(ACTIVITY_PATH, { query: { ...query.value, before: cursor.value } })
    older.value = [...older.value, ...page.events]
    olderCursor.value = page.nextCursor
  }
  catch (e) {
    toast.add({ title: 'Couldn\'t load older activity', description: toApiError(e).message, color: 'error' })
  }
  finally {
    loadingOlder.value = false
  }
}
</script>
