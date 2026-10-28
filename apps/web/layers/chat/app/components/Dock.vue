<template>
  <ChatPanel :entries="entries" />
  <ChatRail :entries="entries" />
</template>

<script setup lang="ts">
// One place computes the entries so each contributing source runs once and the thread list polls once.
const { entries } = useChatRailEntries()
useChatDeepLink()
</script>
