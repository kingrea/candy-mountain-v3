<template>
  <DeltaWidget />
  <p>{{ deltaFormat(1) }} {{ byName(2) }} {{ byPath(3) }} {{ deltaDefinition.id }}</p>
</template>

<script setup lang="ts">
import { deltaDefinition } from '@fixture/delta'
import { deltaFormat as byName } from '@fixture/delta/app/utils/delta'
import { deltaFormat as byPath } from '../../../delta-layer/app/utils/delta'
</script>
