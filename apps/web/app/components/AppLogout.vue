<script setup lang="ts">
import { AUTH_STRATEGY_PATH, LOGOUT_PATH, type AuthStrategyResponse } from '@candy-mountain/shared'

const { user, setUser } = useCurrentUser()
const { $api } = useNuxtApp()
const { data } = useApi<AuthStrategyResponse>(AUTH_STRATEGY_PATH, { key: 'auth-strategy' })

// Logout only exists under the password strategy.
const visible = computed(() => data.value?.strategy === 'password' && user.value !== null)
const loading = ref(false)

async function logout() {
  loading.value = true
  try {
    await $api(LOGOUT_PATH, { method: 'POST' })
    setUser(null)
    await navigateTo(LOGIN_PAGE_PATH, { replace: true })
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <UButton
    v-if="visible"
    color="neutral"
    variant="ghost"
    icon="i-lucide-log-out"
    :label="user?.displayName"
    aria-label="Sign out"
    :loading="loading"
    @click="logout"
  />
</template>
