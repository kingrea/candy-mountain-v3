<template>
  <UApp>
    <DaemonUnreachable v-if="status.unreachable" :daemon-url="status.daemonUrl" />
    <NuxtLayout v-else>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

<script setup lang="ts">
// Here rather than nuxt.config app.head, which is JSON-serialised and drops functions.
useHead({ titleTemplate: title => (title ? `${title} · ${PRODUCT.name}` : PRODUCT.name) })

const { status, check } = useDaemonStatus()

// Polling runs even while healthy so a daemon that stops between API calls is noticed.
onMounted(() => {
  const timer = setInterval(check, DAEMON_POLL_INTERVAL_MS)
  onScopeDispose(() => clearInterval(timer))
})
</script>
