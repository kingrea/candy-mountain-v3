<template>
  <CapabilityViewGate capability="zeta" view="zeta">
    <template #default="{ capability }">
      <UDashboardPanel id="zeta">
        <template #header>
          <UDashboardNavbar title="Zeta" />
        </template>
        <template #body>
          <ZetaRecords :tools="capability.tools" />
        </template>
      </UDashboardPanel>
    </template>
  </CapabilityViewGate>
</template>
