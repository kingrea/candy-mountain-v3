<template>
  <ChatPanel :limit="CORE_LIMIT" />
  <p>{{ useCoreThing() }} {{ deltaFormat(DELTA_LIMIT) }} {{ ownFormat(1) }}</p>
</template>

<script setup lang="ts">
import { CORE_LIMIT } from '~/utils/core'
import { DELTA_LIMIT } from '#layers/delta/app/composables/useDelta'
import { deltaFormat as ownFormat } from '@fixture/delta/app/utils/delta'

useChatThread()
</script>
