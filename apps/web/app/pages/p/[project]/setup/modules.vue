<script setup lang="ts">
useHead({ title: 'Modules' })

const { registry, status, refresh } = useProjectRegistry()
</script>

<template>
  <UDashboardPanel id="setup-modules">
    <template #header>
      <UDashboardNavbar title="Modules" />
    </template>

    <template #body>
      <ModulesSetup v-if="registry?.admin" :registry="registry" />
      <UEmpty
        v-else-if="registry"
        icon="i-lucide-shield-off"
        title="Only the admin can set up modules"
        description="Ask the admin to enable modules for this project."
      />
      <UEmpty
        v-else-if="status === 'error'"
        icon="i-lucide-circle-x"
        title="Couldn't load this project's setup"
        description="The daemon did not answer. Try again in a moment."
        :actions="[{ label: 'Try again', icon: 'i-lucide-refresh-cw', onClick: () => { refresh() } }]"
      />
      <UEmpty v-else loading title="Loading modules" />
    </template>
  </UDashboardPanel>
</template>
