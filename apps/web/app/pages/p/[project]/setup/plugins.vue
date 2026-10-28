<script setup lang="ts">
import { isAdmin } from '@candy-mountain/shared'

useHead({ title: 'Plugins' })

const { registry } = useProjectRegistry()
const { user } = useCurrentUser()
const admin = computed(() => registry.value?.admin ?? (user.value ? isAdmin(user.value) : false))
</script>

<template>
  <UDashboardPanel id="setup-plugins">
    <template #header>
      <UDashboardNavbar title="Plugins" />
    </template>

    <template #body>
      <PluginsSetup v-if="admin" />
      <UEmpty
        v-else
        icon="i-lucide-lock"
        title="Only the admin manages plugins"
        description="Plugins hold credentials, so they are set up by the admin."
      />
    </template>
  </UDashboardPanel>
</template>
