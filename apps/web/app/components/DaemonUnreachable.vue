<template>
  <main class="flex min-h-svh flex-col items-center justify-center gap-4 bg-default p-6 text-center" role="alert">
    <UIcon name="i-lucide-unplug" class="size-12 text-warning" />
    <h1 class="text-2xl font-bold text-highlighted">
      Can't reach the daemon
    </h1>
    <p class="max-w-md text-muted">
      The web app is running, but the Candy Mountain daemon is not answering
      <template v-if="daemonUrl">
        at <code class="rounded bg-elevated px-1.5 py-0.5 text-default">{{ daemonUrl }}</code>
      </template>.
      This page checks again every few seconds and returns on its own once the daemon is back.
    </p>
    <UButton icon="i-lucide-refresh-cw" :loading="retrying" @click="retry">
      Retry now
    </UButton>
  </main>
</template>

<script setup lang="ts">
defineProps<{ daemonUrl: string }>()

const { check } = useDaemonStatus()
const retrying = ref(false)

async function retry() {
  retrying.value = true
  try {
    await check()
  }
  finally {
    retrying.value = false
  }
}
</script>
