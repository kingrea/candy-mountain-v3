<script setup lang="ts">
import type { PluginInstance, PluginTypeInfo, RepositoryBranchList } from '@candy-mountain/shared'

const props = defineProps<{
  instance: PluginInstance
  type: PluginTypeInfo
}>()

const BRANCH_LIMIT = 10

const { pluginAction } = usePluginActions()

const branches = ref<RepositoryBranchList | null>(null)
const loading = ref(false)
const error = ref<ApiErrorInfo | null>(null)
let request = 0

const healthy = computed(() => props.instance.health?.healthy === true)

async function load() {
  const current = ++request
  loading.value = true
  error.value = null
  try {
    const list = await pluginAction<RepositoryBranchList>(props.instance.id, 'branches', { query: { limit: BRANCH_LIMIT } })
    if (current === request) branches.value = list
  }
  catch (failure) {
    if (current === request) error.value = toApiError(failure)
  }
  finally {
    if (current === request) loading.value = false
  }
}

// Branches are fetched in the browser only, after a healthy test, so rendering the page never waits on the host.
onMounted(() => {
  watch(() => (healthy.value ? props.instance.health?.checkedAt : null), (checkedAt) => {
    request++
    branches.value = null
    error.value = null
    loading.value = false
    if (checkedAt) load()
  }, { immediate: true })
})
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="repository-branches">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-medium text-highlighted">
        Recent branches
      </h3>
      <UButton
        v-if="healthy"
        icon="i-lucide-refresh-cw"
        size="xs"
        color="neutral"
        variant="ghost"
        aria-label="Reload branches"
        :loading="loading"
        @click="load"
      />
    </div>

    <p v-if="!healthy" class="text-sm text-muted">
      Branches show here once a connection test succeeds.
    </p>
    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="error.message"
      :description="error.code"
    />
    <div v-else-if="loading && !branches" class="flex flex-col gap-1">
      <USkeleton v-for="n in 3" :key="n" class="h-5 w-full" />
    </div>
    <template v-else-if="branches">
      <p v-if="!branches.branches.length" class="text-sm text-muted">
        The repository has no branches.
      </p>
      <ul v-else class="flex flex-col divide-y divide-default text-sm">
        <li
          v-for="branch in branches.branches"
          :key="branch.name"
          class="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5"
          data-testid="repository-branch"
        >
          <span class="min-w-0 truncate font-mono text-default" :title="branch.name">{{ branch.name }}</span>
          <UBadge v-if="branch.name === branches.defaultBranch" label="default" color="primary" variant="subtle" size="sm" />
          <span class="ml-auto font-mono text-xs text-dimmed">{{ branch.sha.slice(0, 7) }}</span>
          <NuxtTime v-if="branch.committedAt" :datetime="branch.committedAt" relative numeric="auto" title class="text-xs text-muted" />
        </li>
      </ul>
    </template>
  </div>
</template>
