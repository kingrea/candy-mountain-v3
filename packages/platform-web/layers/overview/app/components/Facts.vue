<template>
  <UCard v-if="project">
    <template #header>
      <h2 class="font-semibold text-highlighted">
        Project
      </h2>
    </template>

    <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm" data-testid="overview-facts">
      <dt class="text-muted">
        Organisation
      </dt>
      <dd class="text-highlighted">
        {{ organisationName }}
      </dd>
    </dl>
  </UCard>
</template>

<script setup lang="ts">
const { project, organisations } = useSelectedProject()

const organisationName = computed(() =>
  organisations.value.find(organisation => organisation.id === project.value?.organisationId)?.name ?? 'Ungrouped',
)
</script>
