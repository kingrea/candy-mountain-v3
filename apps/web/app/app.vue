<template>
  <UApp>
    <DaemonUnreachable v-if="status.unreachable" :daemon-url="status.daemonUrl" />
    <NuxtLayout v-else>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

<script setup lang="ts">
const { status, check } = useDaemonStatus()

// Polling runs even while healthy so a daemon that stops between API calls is noticed.
onMounted(() => {
  const timer = setInterval(check, DAEMON_POLL_INTERVAL_MS)
  onScopeDispose(() => clearInterval(timer))
})
</script>
