<template>
  <CoreBadge />
  <ChatPanel :limit="EPSILON_LIMIT" />
  <p>{{ epsilonFormat(CORE_LIMIT) }} {{ useEpsilon() }}</p>
</template>

<script setup lang="ts">
import { CORE_LIMIT } from '#layers/platform-web/app/utils/core'
import { EPSILON_LIMIT } from '../../src/wire'
</script>
