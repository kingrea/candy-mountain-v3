<template>
  <UDashboardGroup storage-key="cm-dashboard" class="flex-col">
    <AppHeader>
      <template #actions>
        <UColorModeButton />
        <AppLogout />
      </template>
    </AppHeader>

    <!-- Sidebar and panels default to min-h-svh, which would push them below the header. -->
    <div class="relative flex min-h-0 flex-1 overflow-hidden [&>*]:min-h-0">
      <UDashboardSidebar
        collapsible
        resizable
        :ui="{ header: 'px-2', body: 'px-2', footer: 'hidden lg:flex px-2' }"
      >
        <template #header="{ collapsed }">
          <ProjectPicker :collapsed="collapsed" />
        </template>

        <template #default="{ collapsed }">
          <AppNav :collapsed="collapsed" />
        </template>

        <template #footer="{ collapsed }">
          <UDashboardSidebarCollapse
            :label="collapsed ? undefined : 'Collapse'"
            :class="collapsed ? 'size-8 justify-center' : 'w-full justify-start'"
          />
        </template>
      </UDashboardSidebar>

      <slot />
      <ChatDock />
    </div>
  </UDashboardGroup>
</template>
