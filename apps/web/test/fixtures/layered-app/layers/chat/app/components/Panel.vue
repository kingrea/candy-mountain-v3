<template>
  <p>{{ thread }}</p>
</template>

<script setup lang="ts">
const thread = useChatThread() + useCoreThing()
</script>
