<script setup lang="ts">
import type { Environment, RegistryCapability } from '@candy-mountain/shared'

const { registry } = useProjectRegistry()

const editing = ref<Environment | null | undefined>()

// The daemon only lets the admin change environments, whatever the rung says.
const canManage = (capability: RegistryCapability) =>
  Boolean(registry.value?.admin) && capability.tools.includes(DEPLOYMENTS_MANAGE_TOOL)
</script>

<template>
  <CapabilityViewGate v-slot="{ capability }" capability="deployments" view="deployments">
    <UDashboardPanel id="deployments">
      <template #header>
        <UDashboardNavbar title="Deployments">
          <template #right>
            <UButton
              v-if="canManage(capability)"
              icon="i-lucide-plus"
              label="New environment"
              data-testid="new-environment"
              @click="editing = null"
            />
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <DeploymentsManager v-model:editing="editing" :can-manage="canManage(capability)" />
      </template>
    </UDashboardPanel>
  </CapabilityViewGate>
</template>
