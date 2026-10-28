<script setup lang="ts">
import type { Bot } from '@candy-mountain/shared'

const editing = ref<Bot | null | undefined>()
</script>

<template>
  <CapabilityViewGate capability="bots" view="bots">
    <UDashboardPanel id="bots">
      <template #header>
        <UDashboardNavbar title="Bots">
          <template #right>
            <UButton icon="i-lucide-plus" label="New bot" data-testid="new-bot" @click="editing = null" />
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <BotsManager v-model:editing="editing" />
      </template>
    </UDashboardPanel>
  </CapabilityViewGate>
</template>
