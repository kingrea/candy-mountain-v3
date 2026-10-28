<script setup lang="ts">
useHead({ title: 'Notifications' })

const { registry, status, refresh } = useProjectRegistry()
</script>

<template>
  <UDashboardPanel id="setup-notifications">
    <template #header>
      <UDashboardNavbar title="Notifications" />
    </template>

    <template #body>
      <NotificationsSetup v-if="registry?.admin" :registry="registry" />
      <UEmpty
        v-else-if="registry"
        icon="i-lucide-shield-off"
        title="Only the admin can set up notifications"
        description="Ask the admin to choose where this project's notifications go."
      />
      <UEmpty
        v-else-if="status === 'error'"
        icon="i-lucide-circle-x"
        title="Couldn't load this project's setup"
        description="The daemon did not answer. Try again in a moment."
        :actions="[{ label: 'Try again', icon: 'i-lucide-refresh-cw', onClick: () => { refresh() } }]"
      />
      <UEmpty v-else loading title="Loading notifications" />
    </template>
  </UDashboardPanel>
</template>
