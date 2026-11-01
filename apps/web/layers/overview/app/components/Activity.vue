<template>
  <UCard :ui="{ body: 'p-0 sm:p-0' }">
    <template #header>
      <h2 class="font-semibold text-highlighted">
        Activity
      </h2>
    </template>

    <div class="flex flex-wrap gap-2 border-b border-default px-4 py-3 sm:px-6" data-testid="overview-activity-filters">
      <USelectMenu
        v-model="types"
        :items="OVERVIEW_TYPE_ITEMS"
        value-key="value"
        multiple
        placeholder="All event types"
        icon="i-lucide-filter"
        class="w-full sm:w-60"
        aria-label="Filter by event type"
        data-testid="overview-activity-types"
      />
      <USelect
        v-model="range"
        :items="rangeItems"
        class="w-full sm:w-44"
        aria-label="Filter by time range"
        data-testid="overview-activity-range"
      />
      <UButton v-if="filtered" label="Clear filters" color="neutral" variant="ghost" size="sm" @click="clearFilters" />
    </div>

    <UEmpty
      v-if="error"
      variant="naked"
      icon="i-lucide-circle-x"
      title="Couldn't load activity"
      :actions="[{ label: 'Try again', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => refresh() }]"
    />
    <UEmpty
      v-else-if="status === 'success' && !events.length && filtered"
      variant="naked"
      icon="i-lucide-filter-x"
      title="No matching activity"
      description="Nothing matches these filters. Try a wider time range or more event types."
      :actions="[{ label: 'Clear filters', color: 'neutral', variant: 'outline', onClick: clearFilters }]"
      data-testid="overview-activity-no-match"
    />
    <UEmpty
      v-else-if="status === 'success' && !events.length"
      variant="naked"
      icon="i-lucide-history"
      title="Nothing has happened yet"
      description="Agent sessions, bot runs, incidents and deploys will show up here."
      data-testid="overview-activity-empty"
    />
    <ul v-else class="divide-y divide-default" data-testid="overview-activity">
      <li v-for="event in events" :key="event.id">
        <component
          :is="event.link ? NuxtLink : 'div'"
          :to="event.link ?? undefined"
          class="flex items-start gap-3 px-4 py-3 sm:px-6"
          :class="event.link ? 'hover:bg-elevated/50' : ''"
        >
          <UIcon :name="kind(event).icon" class="mt-0.5 size-4 shrink-0 text-muted" />
          <div class="min-w-0 flex-1">
            <p class="text-sm text-highlighted">
              {{ event.title }}
            </p>
            <p class="text-xs text-muted">
              {{ kind(event).label }} · <NuxtTime :datetime="event.occurredAt" relative />
            </p>
          </div>
          <UIcon v-if="event.link" name="i-lucide-chevron-right" class="mt-0.5 size-4 shrink-0 text-dimmed" />
        </component>
      </li>
    </ul>

    <template v-if="cursor" #footer>
      <UButton label="Show older" color="neutral" variant="outline" size="sm" :loading="loadingOlder" @click="loadOlder" />
    </template>
  </UCard>
</template>

<script setup lang="ts">
import { projectActivityPath, type ActivityEvent, type ActivityEventType, type ActivityListResponse } from '@candy-mountain/shared'
import { NuxtLink } from '#components'

const { slug } = useSelectedProject()
const { $api } = useNuxtApp()
const toast = useToast()

const route = useRoute()
const router = useRouter()

const rangeItems = OVERVIEW_RANGES.map(({ value, label }) => ({ value, label }))

const types = computed<ActivityEventType[]>({
  // Only listed types are offered, and the daemon refuses a filter on a type it does not register.
  get: () => String(route.query.type ?? '').split(',').filter(t => Object.hasOwn(OVERVIEW_EVENT_KINDS, t)),
  set: value => setQuery({ type: value.length ? value.join(',') : undefined }),
})
const range = computed<OverviewRange>({
  get: () => OVERVIEW_RANGES.find(r => r.value === route.query.range)?.value ?? 'all',
  set: value => setQuery({ range: value === 'all' ? undefined : value }),
})
const filtered = computed(() => types.value.length > 0 || range.value !== 'all')

function setQuery(patch: Record<string, string | undefined>) {
  router.replace({ query: { ...route.query, ...patch } })
}

function clearFilters() {
  setQuery({ type: undefined, range: undefined })
}

// Shared via useState and minute-rounded so SSR and hydration build the same request key.
const now = useState('overview-activity-now', () => Math.floor(Date.now() / 60_000) * 60_000)

function filterQuery() {
  const ms = OVERVIEW_RANGES.find(r => r.value === range.value)?.ms
  return {
    type: types.value.length ? types.value.join(',') : undefined,
    since: ms ? new Date(now.value - ms).toISOString() : undefined,
  }
}

watch([types, range], () => {
  now.value = Math.floor(Date.now() / 60_000) * 60_000
})

const { data, status, error, refresh } = useApi<ActivityListResponse>(() => projectActivityPath(slug.value!), { query: computed(filterQuery) })

const older = ref<ActivityEvent[]>([])
const olderCursor = ref<string | null>()
const loadingOlder = ref(false)

watch(data, () => {
  older.value = []
  olderCursor.value = undefined
})

const events = computed(() => [...(data.value?.events ?? []), ...older.value])
const cursor = computed(() => (olderCursor.value === undefined ? data.value?.nextCursor ?? null : olderCursor.value))

// Core's fallback words and icon cover a type this layer does not list.
const kind = (event: ActivityEvent) => OVERVIEW_EVENT_KINDS[event.type] ?? activityEventKind(event.type)

async function loadOlder() {
  if (!cursor.value || !slug.value) return
  loadingOlder.value = true
  try {
    const page = await $api<ActivityListResponse>(projectActivityPath(slug.value), { query: { ...filterQuery(), before: cursor.value } })
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
