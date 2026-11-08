<template>
  <header class="flex h-(--ui-header-height) shrink-0 items-center gap-3 border-b border-muted bg-shell px-4">
    <UDashboardSidebarToggle color="neutral" variant="ghost" />

    <NuxtLink to="/" :aria-label="`${PRODUCT.name} home`" class="flex shrink-0 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-primary">
      <AppIcon :icon="PRODUCT.theme.logo" class="size-5 text-primary" />
      <span class="hidden text-sm font-semibold tracking-tight text-highlighted sm:inline">{{ PRODUCT.name }}</span>
    </NuxtLink>

    <div class="flex shrink-0 items-center gap-1 ms-auto">
      <slot name="actions" />
    </div>
  </header>
</template>
