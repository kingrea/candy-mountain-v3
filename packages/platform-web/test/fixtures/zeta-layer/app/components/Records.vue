<script setup lang="ts">
import { ZETA_MANAGE_TOOL, zetaRecordsPath, type ZetaRecordListResponse } from '../utils/zeta'

const props = defineProps<{ tools: readonly string[] }>()

const { slug } = useSelectedProject()
const { $api } = useNuxtApp()
const toast = useToast()

const { data, status, refresh } = useAsyncData(
  () => `zeta:${slug.value}`,
  () => (slug.value ? $api<ZetaRecordListResponse>(zetaRecordsPath(slug.value)) : Promise.resolve({ records: [] })),
)
const records = computed(() => data.value?.records ?? [])
const canManage = computed(() => props.tools.includes(ZETA_MANAGE_TOOL))

async function add() {
  if (!slug.value) return
  await $api(zetaRecordsPath(slug.value), { method: 'POST', body: { title: 'New record' } })
  toast.add({ title: 'Record added' })
  await refresh()
}
</script>

<template>
  <div data-testid="zeta-records">
    <UButton v-if="canManage" label="Add record" data-testid="zeta-add" @click="add" />
    <USkeleton v-if="status === 'pending'" />
    <ul v-else-if="records.length">
      <li v-for="record in records" :key="record.id" data-testid="zeta-record">
        {{ record.title }}
      </li>
    </ul>
    <p v-else data-testid="zeta-empty">
      No records in this {{ SCOPE.singular }} yet.
    </p>
  </div>
</template>
