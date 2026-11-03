<template>
  <p>{{ limit }}</p>
</template>

<script setup lang="ts">
import { ALPHA_LIMIT } from '#layers/alpha/app/composables/useAlpha'

const limit = ALPHA_LIMIT
</script>
