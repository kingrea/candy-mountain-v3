<script setup lang="ts">
import { ADMIN_ROLE, CAPABILITY_CATALOG_PATH, GRANTS_PATH, type CapabilityCatalogResponse, type GrantListResponse } from '@candy-mountain/shared'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Grants' })

const { data: catalog, status: catalogStatus, error: catalogError } = useApi<CapabilityCatalogResponse>(CAPABILITY_CATALOG_PATH)
const { data: grants, status: grantsStatus, error: grantsError, refresh } = useApi<GrantListResponse>(GRANTS_PATH)

const pending = computed(() => catalogStatus.value === 'pending' || grantsStatus.value === 'pending')
const error = computed(() => catalogError.value ?? grantsError.value)
const roles = computed(() => {
  const all = grants.value?.roles ?? []
  return [...all.filter(r => r.role === ADMIN_ROLE), ...all.filter(r => r.role !== ADMIN_ROLE)]
})
const onlyAdmin = computed(() => roles.value.every(r => r.role === ADMIN_ROLE))

async function onChanged() {
  await refresh()
  await refreshProjectRegistry()
}
</script>

<template>
  <UDashboardPanel id="grants">
    <template #header>
      <UDashboardNavbar title="Grants" />
    </template>

    <template #body>
      <div class="flex flex-col gap-4">
        <p class="max-w-2xl text-sm text-muted">
          The rung each role holds on every capability. Grants add up: a role keeps the highest rung any of its grants gives it. The admin role always holds the top rung and cannot be edited.
        </p>

        <USkeleton v-if="pending" class="h-40 w-full" />
        <UAlert v-else-if="error || !catalog" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Grants unavailable" :description="error ? toApiError(error).message : 'The daemon returned no capabilities.'" />
        <template v-else>
          <GrantsTable :catalog="catalog" :roles="roles" @changed="onChanged" />
          <UAlert v-if="onlyAdmin" color="neutral" variant="subtle" icon="i-lucide-info" data-testid="grants-only-admin" description="Only the admin role exists, so there is nothing to edit yet. Other roles will appear here once they are added." />
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
