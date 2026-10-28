<script setup lang="ts">
import { INFO_PATH, PLATFORM_SETTINGS_PATH, type InfoResponse, type PlatformSettings, type UpdatePlatformSettingsRequest } from '@candy-mountain/shared'

definePageMeta({ layout: 'dashboard' })
useHead({ title: 'Settings' })

const { data: info, status } = useApi<InfoResponse>(INFO_PATH)

const { data: platform, status: platformStatus, error: platformError } = useApi<PlatformSettings>(PLATFORM_SETTINGS_PATH)
const { $api } = useNuxtApp()
const toast = useToast()

const form = reactive({ gatewayBaseUrl: '', modelId: '', gatewayKey: '' })
const saving = ref(false)
const formError = ref<string | null>(null)

watch(platform, (value) => {
  if (!value) return
  form.gatewayBaseUrl = value.gatewayBaseUrl ?? ''
  form.modelId = value.modelId ?? ''
}, { immediate: true })

async function save(patch: UpdatePlatformSettingsRequest, message: string) {
  formError.value = null
  saving.value = true
  try {
    platform.value = await $api<PlatformSettings>(PLATFORM_SETTINGS_PATH, { method: 'PUT', body: patch })
    form.gatewayKey = ''
    toast.add({ title: message, color: 'success' })
  }
  catch (e) {
    formError.value = toApiError(e).message
  }
  finally {
    saving.value = false
  }
}

function onSubmit() {
  const patch: UpdatePlatformSettingsRequest = { gatewayBaseUrl: form.gatewayBaseUrl, modelId: form.modelId }
  if (form.gatewayKey) patch.gatewayKey = form.gatewayKey
  return save(patch, 'Settings saved')
}

const rows = computed(() => [
  { label: 'Daemon version', value: info.value?.version },
  { label: 'Data directory', value: info.value?.dataDir },
  { label: 'Auth strategy', value: info.value?.authStrategy },
])
</script>

<template>
  <UDashboardPanel id="settings">
    <template #header>
      <UDashboardNavbar title="Settings" />
    </template>

    <template #body>
      <div class="flex max-w-2xl flex-col gap-6">
        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              System
            </h2>
          </template>

          <dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3 text-sm">
            <template v-for="row in rows" :key="row.label">
              <dt class="text-muted">
                {{ row.label }}
              </dt>
              <dd class="break-all font-mono text-highlighted">
                <USkeleton v-if="status === 'pending'" class="h-4 w-40" />
                <template v-else>
                  {{ row.value ?? 'unavailable' }}
                </template>
              </dd>
            </template>
          </dl>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold text-highlighted">
              Platform agent
            </h2>
          </template>

          <USkeleton v-if="platformStatus === 'pending'" class="h-40 w-full" />
          <UAlert v-else-if="platformError" color="error" variant="subtle" icon="i-lucide-circle-alert" title="Platform settings unavailable" :description="toApiError(platformError).message" />
          <UForm v-else :state="form" class="flex flex-col gap-4" @submit="onSubmit">
            <UAlert v-if="formError" color="error" variant="subtle" icon="i-lucide-circle-alert" :description="formError" />
            <UAlert v-if="platform && !platform.secretsUnlocked" color="warning" variant="subtle" icon="i-lucide-lock" description="The secrets key is not configured on the daemon, so the gateway key cannot be saved." />

            <UFormField label="Gateway base URL" name="gatewayBaseUrl">
              <UInput v-model="form.gatewayBaseUrl" placeholder="https://gateway.example.com/v1" class="w-full" />
            </UFormField>

            <UFormField label="Model id" name="modelId">
              <UInput v-model="form.modelId" placeholder="claude-sonnet-5-5" class="w-full" />
            </UFormField>

            <UFormField label="Gateway key" name="gatewayKey" :help="platform?.gatewayKeySet ? 'A key is set. Enter a new value to replace it.' : 'No key set.'">
              <div class="flex items-center gap-2">
                <UInput v-model="form.gatewayKey" type="password" autocomplete="off" :placeholder="platform?.gatewayKeySet ? 'Set' : 'Not set'" :disabled="!platform?.secretsUnlocked" class="w-full" />
                <UBadge v-if="platform?.gatewayKeySet" label="Set" color="success" variant="subtle" />
                <UButton v-if="platform?.gatewayKeySet" label="Clear" color="neutral" variant="outline" :disabled="saving" @click="save({ gatewayKey: null }, 'Gateway key cleared')" />
              </div>
            </UFormField>

            <div>
              <UButton type="submit" label="Save" :loading="saving" />
            </div>
          </UForm>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
