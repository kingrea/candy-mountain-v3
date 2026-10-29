<template>
  <header class="flex h-(--ui-header-height) shrink-0 items-center gap-3 border-b border-default bg-default px-4">
    <UDashboardSidebarToggle color="neutral" variant="ghost" />

    <NuxtLink to="/" :aria-label="`${PRODUCT_NAME} home`" class="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-primary">
      <UIcon name="i-lucide-mountain-snow" class="size-6 text-primary" />
      <span class="hidden text-lg font-bold tracking-tight text-highlighted sm:inline">{{ PRODUCT_NAME }}</span>
    </NuxtLink>

    <div class="flex shrink-0 items-center gap-1 ms-auto">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
import { PRODUCT_NAME } from '@candy-mountain/shared'
</script>
