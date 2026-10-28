<template>
  <CapabilityViewGate capability="overview" view="overview">
    <UDashboardPanel id="overview">
      <template #header>
        <UDashboardNavbar :title="project?.name ?? 'Overview'">
          <template #leading>
            <ProjectColorDot v-if="project" :color="project.color" class="size-3" />
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <OverviewActivity class="order-last lg:order-first" />
          <div class="flex flex-col gap-6">
            <OverviewFacts />
            <OverviewModules />
            <OverviewPlugins />
          </div>
        </div>
      </template>
    </UDashboardPanel>
  </CapabilityViewGate>
</template>

<script setup lang="ts">
const { project } = useSelectedProject()
</script>
