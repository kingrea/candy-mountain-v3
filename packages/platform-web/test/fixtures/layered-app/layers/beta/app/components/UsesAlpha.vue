<template>
  <AlphaCard />
  <p>{{ rows }} {{ alphaFormat(1) }}</p>
</template>

<script setup lang="ts">
import { useAlpha } from '#imports'
import { ALPHA_LIMIT } from '#layers/alpha/app/composables/useAlpha'

const rows = useAlpha().length + ALPHA_LIMIT
</script>
