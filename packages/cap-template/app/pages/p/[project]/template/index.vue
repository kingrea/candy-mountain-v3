<script setup lang="ts">
import type { RegistryCapability } from '@candy-mountain/platform-sdk'
import { TEMPLATE_MANAGE_TOOL } from '../../../../../src/wire'

const canCreate = (capability: RegistryCapability) => capability.tools.includes(TEMPLATE_MANAGE_TOOL)
</script>

<template>
  <CapabilityViewGate v-slot="{ capability }" capability="template" view="template">
    <UDashboardPanel id="template">
      <template #header>
        <UDashboardNavbar title="Template" />
      </template>

      <template #body>
        <TemplateNotes :can-create="canCreate(capability)" />
      </template>
    </UDashboardPanel>
  </CapabilityViewGate>
</template>
