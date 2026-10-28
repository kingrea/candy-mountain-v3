<template>
  <ChatPanel :limit="CORE_LIMIT" />
  <p>{{ useCoreThing() }} {{ alphaFormat(ALPHA_LIMIT) }}</p>
</template>

<script setup lang="ts">
import { CORE_LIMIT } from '~/utils/core'
import { ALPHA_LIMIT } from '#layers/alpha/app/composables/useAlpha'

useChatThread()
</script>
