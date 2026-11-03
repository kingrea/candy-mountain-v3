<template>
  <DeltaWidget />
  <p>{{ rows }} {{ deltaFormat(1) }} {{ format(2) }}</p>
</template>

<script setup lang="ts">
import { useDelta } from '#imports'
import { DELTA_LIMIT } from '#layers/delta/app/composables/useDelta'
import { deltaFormat as format } from '@fixture/delta/app/utils/delta'

const rows = useDelta().length + DELTA_LIMIT
</script>
