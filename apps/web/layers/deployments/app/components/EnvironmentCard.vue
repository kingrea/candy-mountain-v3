<script setup lang="ts">
import type { Environment } from '@candy-mountain/shared'

const props = defineProps<{
  environment: Environment
  sourceLabel: string
  live: DeploymentsLiveState
  canManage: boolean
}>()

const emit = defineEmits<{
  edit: [environment: Environment]
  delete: [environment: Environment]
}>()

const version = computed(() => (props.live.state === 'live' ? props.live.version : null))
</script>

<template>
  <UCard
    :ui="{ body: 'flex flex-col gap-4' }"
    :data-testid="`environment-card-${environment.name}`"
    :data-live-state="live.state"
  >
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <UIcon :name="deploymentsSourceIcon(environment.liveSourceKind)" class="size-5 shrink-0 text-muted" />
          <h3 class="truncate font-semibold text-highlighted">
            {{ environment.name }}
          </h3>
        </div>
        <UBadge :label="sourceLabel" color="neutral" variant="subtle" class="shrink-0" data-testid="environment-source" />
      </div>
    </template>

    <div v-if="live.state === 'loading'" class="flex flex-col gap-2" data-testid="live-loading">
      <USkeleton v-for="n in 4" :key="n" class="h-5 w-full" />
    </div>

    <UAlert
      v-else-if="live.state === 'error'"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Could not read what is live"
      :description="live.error"
      data-testid="live-error"
    />

    <p v-else-if="live.state === 'unavailable'" class="text-sm text-muted" data-testid="live-unavailable">
      The live version could not be loaded.
    </p>

    <p v-else-if="live.state === 'empty'" class="text-sm text-muted" data-testid="live-empty">
      Nothing deployed yet.
    </p>

    <dl v-else-if="version" class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm" data-testid="live-fields">
      <dt class="text-muted">
        {{ DEPLOYMENTS_FIELD_LABELS.version }}
      </dt>
      <dd data-testid="live-version">
        <span v-if="version.version" class="font-mono" :title="version.version">{{ deploymentsShortVersion(version.version) }}</span>
        <span v-else class="text-muted">Not reported</span>
      </dd>

      <dt class="text-muted">
        {{ DEPLOYMENTS_FIELD_LABELS.branch }}
      </dt>
      <dd data-testid="live-branch">
        <span v-if="version.branch" class="font-mono">{{ version.branch }}</span>
        <span v-else class="text-muted">Not reported</span>
      </dd>

      <dt class="text-muted">
        {{ DEPLOYMENTS_FIELD_LABELS.deployedAt }}
      </dt>
      <dd data-testid="live-deployedAt">
        <NuxtTime v-if="version.deployedAt" :datetime="version.deployedAt" relative numeric="auto" title />
        <span v-else class="text-muted">Not reported</span>
      </dd>

      <dt class="text-muted">
        {{ DEPLOYMENTS_FIELD_LABELS.link }}
      </dt>
      <dd class="min-w-0" data-testid="live-link">
        <ULink
          v-if="version.link"
          :to="version.link"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex max-w-full items-center gap-1"
        >
          <span class="truncate">{{ deploymentsLinkText(version.link) }}</span>
          <UIcon name="i-lucide-external-link" class="size-3.5 shrink-0" />
        </ULink>
        <span v-else class="text-muted">Not reported</span>
      </dd>
    </dl>

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs text-muted" data-testid="live-checked">
          <template v-if="'checkedAt' in live">Checked <NuxtTime :datetime="live.checkedAt" relative numeric="auto" title /></template>
        </span>
        <div v-if="canManage" class="flex gap-2">
          <UButton label="Edit" icon="i-lucide-pencil" color="neutral" variant="outline" size="sm" data-testid="environment-edit" @click="emit('edit', environment)" />
          <UButton label="Delete" icon="i-lucide-trash-2" color="error" variant="soft" size="sm" data-testid="environment-delete" @click="emit('delete', environment)" />
        </div>
      </div>
    </template>
  </UCard>
</template>
