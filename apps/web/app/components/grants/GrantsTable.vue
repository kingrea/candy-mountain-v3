<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { ADMIN_ROLE, GRANTS_PATH, type CapabilityCatalogResponse, type CatalogCapability, type GrantListResponse, type RoleRungs, type SetGrantRequest } from '@candy-mountain/shared'

const props = defineProps<{
  catalog: CapabilityCatalogResponse
  roles: RoleRungs[]
}>()
const emit = defineEmits<{ changed: [] }>()

const { $api } = useNuxtApp()
const toast = useToast()
const saving = ref<string | null>(null)

const moduleLabels = computed(() => new Map(props.catalog.modules.map(m => [m.id, m.label])))
const byId = computed(() => new Map(props.catalog.capabilities.map(cap => [cap.id, cap])))

const columns = computed<TableColumn<RoleRungs>[]>(() => [
  { id: 'role', header: 'Role' },
  ...props.catalog.capabilities.map(cap => ({ id: cap.id, header: cap.label })),
])

function groupOf(cap: CatalogCapability) {
  return cap.moduleIds.length ? cap.moduleIds.map(id => moduleLabels.value.get(id) ?? id).join(', ') : 'Standalone'
}

function items(cap: CatalogCapability) {
  return cap.rungs.map(rung => ({ label: rung.label, value: rung.name }))
}

function rungLabel(cap: CatalogCapability, name: string | undefined) {
  return cap.rungs.find(rung => rung.name === name)?.label ?? name ?? 'none'
}

async function setRung(role: RoleRungs, cap: CatalogCapability, rung: string) {
  saving.value = `${role.role}:${cap.id}`
  try {
    const body: SetGrantRequest = { role: role.role, target: { kind: 'capability', id: cap.id }, rungs: { [cap.id]: rung } }
    await $api<GrantListResponse>(GRANTS_PATH, { method: 'PUT', body })
    toast.add({ title: `${role.name}: ${cap.label} set to ${rungLabel(cap, rung)}`, color: 'success' })
  }
  catch (e) {
    toast.add({ title: 'Could not save the grant', description: toApiError(e).message, color: 'error' })
  }
  finally {
    saving.value = null
    emit('changed')
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <ul class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
      <li v-for="cap in catalog.capabilities" :key="cap.id">
        <span class="font-medium text-default">{{ cap.label }}</span>: {{ groupOf(cap) }}
      </li>
    </ul>

    <UTable :data="roles" :columns="columns" data-testid="grants-table">
      <template #role-cell="{ row }">
        <div class="flex items-center gap-2" :data-testid="`grants-role-${row.original.role}`">
          <span class="font-medium text-highlighted">{{ row.original.name }}</span>
          <UBadge v-if="row.original.role === ADMIN_ROLE" label="Read-only" color="neutral" variant="subtle" />
        </div>
      </template>

      <template v-for="cap in catalog.capabilities" :key="cap.id" #[`${cap.id}-cell`]="{ row }">
        <UBadge
          v-if="row.original.role === ADMIN_ROLE"
          :label="rungLabel(byId.get(cap.id)!, row.original.rungs[cap.id])"
          color="primary"
          variant="subtle"
          :data-testid="`grant-${row.original.role}-${cap.id}`"
        />
        <USelect
          v-else
          :model-value="row.original.rungs[cap.id] ?? 'none'"
          :items="items(cap)"
          :loading="saving === `${row.original.role}:${cap.id}`"
          :disabled="saving !== null"
          size="sm"
          class="w-36"
          :data-testid="`grant-${row.original.role}-${cap.id}`"
          @update:model-value="setRung(row.original, cap, String($event))"
        />
      </template>
    </UTable>
  </div>
</template>
