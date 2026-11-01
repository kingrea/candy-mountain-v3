<template>
  <UCard v-if="project && verification">
    <template #header>
      <h2 class="font-semibold text-highlighted">
        Repository
      </h2>
    </template>

    <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm" data-testid="repository-facts">
      <dt class="text-muted">
        Path
      </dt>
      <dd class="flex flex-col items-start gap-1">
        <span class="break-all font-mono text-highlighted">{{ project.source.path }}</span>
        <UBadge v-if="!verification.pathExists" color="error" variant="subtle" label="Missing on disk" />
      </dd>

      <dt class="text-muted">
        Remote
      </dt>
      <dd class="break-all text-highlighted">
        <template v-if="verification.remoteUrl">
          {{ verification.remoteUrl }}
          <span v-if="verification.remoteName" class="text-muted">({{ verification.remoteName }})</span>
        </template>
        <span v-else-if="verification.isGitRepo" class="text-muted">No remote</span>
        <span v-else class="text-muted">Not a git repository</span>
      </dd>

      <dt class="text-muted">
        Issues
      </dt>
      <dd>
        <UBadge
          :color="verification.hasBeads ? 'success' : 'neutral'"
          variant="subtle"
          :label="verification.hasBeads ? 'Tracked in the repository' : 'Not set up'"
        />
      </dd>

      <dt class="text-muted">
        Checked
      </dt>
      <dd class="text-highlighted">
        <NuxtTime :datetime="verification.checkedAt" relative />
      </dd>
    </dl>
  </UCard>
</template>

<script setup lang="ts">
const { project } = useSelectedProject()

const verification = computed(() => project.value?.verification)
</script>
