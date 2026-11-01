<script setup lang="ts">
import { INVALID_CREDENTIALS_ERROR_CODE, LOGIN_PATH, type LoginRequest, type LoginResponse } from '@candy-mountain/shared'
import { z } from 'zod'

definePageMeta({ layout: false })
useHead({ title: 'Sign in' })

const route = useRoute()
const { setUser } = useCurrentUser()
const { $api } = useNuxtApp()

const schema = z.object({
  username: z.string().min(1, 'Enter your username'),
  password: z.string().min(1, 'Enter your password'),
})

const state = reactive<LoginRequest>({ username: '', password: '' })
const error = ref<string | null>(null)
const submitting = ref(false)

async function onSubmit() {
  error.value = null
  submitting.value = true
  try {
    const { actor } = await $api<LoginResponse>(LOGIN_PATH, { method: 'POST', body: { ...state } })
    setUser(actor)
    await navigateTo(safeRedirectTarget(route.query[LOGIN_REDIRECT_QUERY]), { replace: true })
  }
  catch (e) {
    const info = toApiError(e)
    error.value = info.code === INVALID_CREDENTIALS_ERROR_CODE ? 'Invalid username or password.' : info.message
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="flex min-h-svh items-center justify-center bg-default p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-mountain-snow" class="size-6 text-primary" />
          <h1 class="text-lg font-bold tracking-tight text-highlighted">
            Sign in to {{ PRODUCT.name }}
          </h1>
        </div>
      </template>

      <UForm :schema="schema" :state="state" class="flex flex-col gap-4" @submit="onSubmit">
        <UAlert v-if="error" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="error" />

        <UFormField label="Username" name="username">
          <UInput v-model="state.username" autocomplete="username" autofocus class="w-full" />
        </UFormField>

        <UFormField label="Password" name="password">
          <UInput v-model="state.password" type="password" autocomplete="current-password" class="w-full" />
        </UFormField>

        <UButton type="submit" label="Sign in" block :loading="submitting" />
      </UForm>
    </UCard>
  </main>
</template>
