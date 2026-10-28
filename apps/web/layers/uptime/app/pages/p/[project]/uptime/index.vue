<script setup lang="ts">
import { UPTIME_MANAGE_TOOL, type Monitor, type RegistryCapability } from '@candy-mountain/shared'

const { registry } = useProjectRegistry()

const editing = ref<Monitor | null | undefined>()

// The daemon only lets the admin change monitors, whatever the rung says.
const canManage = (capability: RegistryCapability) =>
  Boolean(registry.value?.admin) && capability.tools.includes(UPTIME_MANAGE_TOOL)
</script>

<template>
  <CapabilityViewGate v-slot="{ capability }" capability="uptime" view="uptime">
    <UDashboardPanel id="uptime">
      <template #header>
        <UDashboardNavbar title="Uptime">
          <template #right>
            <UButton
              v-if="canManage(capability)"
              icon="i-lucide-plus"
              label="New monitor"
              data-testid="new-monitor"
              @click="editing = null"
            />
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <UptimeBoard v-model:editing="editing" :can-manage="canManage(capability)" />
      </template>
    </UDashboardPanel>
  </CapabilityViewGate>
</template>
