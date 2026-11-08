<script setup lang="ts">
import { zetaRecordsPath, type ZetaRecordListResponse } from '../utils/zeta'

const { slug } = useSelectedProject()
const { data } = useApi<ZetaRecordListResponse>(() => zetaRecordsPath(slug.value ?? ''), { key: () => `zeta-card:${slug.value}` })
const count = computed(() => data.value?.records.length ?? 0)
</script>

<template>
  <UCard v-if="count" data-testid="zeta-card">
    {{ count }} zeta records
  </UCard>
</template>
