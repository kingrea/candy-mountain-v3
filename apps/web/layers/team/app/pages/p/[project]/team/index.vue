<script setup lang="ts">
import type { TeamMember } from '@candy-mountain/shared'

const editing = ref<TeamMember | null | undefined>()
</script>

<template>
  <CapabilityViewGate capability="team" view="team">
    <UDashboardPanel id="team">
      <template #header>
        <UDashboardNavbar title="Team">
          <template #right>
            <UButton icon="i-lucide-plus" label="Add member" data-testid="add-member" @click="editing = null" />
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <TeamManager v-model:editing="editing" />
      </template>
    </UDashboardPanel>
  </CapabilityViewGate>
</template>
