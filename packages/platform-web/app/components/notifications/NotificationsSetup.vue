<script setup lang="ts">
import type { RegistryResponse } from '@candy-mountain/platform-sdk'

const props = defineProps<{ registry: RegistryResponse }>()

const { kinds, rules, delivery, deliveryLoading, status, error, saving, errors, save, refresh } = useNotificationRules()

const missing = computed(() => delivery.value.channels.length
  ? `${delivery.value.channels.map(channel => channel.setupHelp).join(' ')} Until then deliveries will fail.`
  : `Nothing in this product can deliver notifications for ${props.registry.workspace.name}.`)
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-6">
    <p class="text-sm text-muted">
      Send messages from {{ registry.workspace.name }} when these events happen.
    </p>

    <UAlert
      v-if="!deliveryLoading && delivery.active"
      color="neutral"
      variant="subtle"
      icon="i-lucide-send"
      data-testid="notification-identity"
      :data-channel="delivery.active.id"
      :title="delivery.active.sender ?? delivery.active.label"
      :description="`Messages are sent through ${delivery.active.label} as this identity.`"
    />
    <UAlert
      v-else-if="!deliveryLoading"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      data-testid="notification-identity"
      data-channel="none"
      title="No delivery channel"
      :description="missing"
      :actions="delivery.channels.map(channel => ({ label: channel.setup.label, to: channel.setup.link, color: 'neutral', variant: 'outline' }))"
    />

    <UAlert
      v-if="status === 'error'"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Couldn't load notifications"
      :description="toApiError(error).message"
      :actions="[{ label: 'Try again', icon: 'i-lucide-refresh-cw', color: 'neutral', variant: 'outline', onClick: () => { refresh() } }]"
    />
    <template v-else-if="!rules">
      <USkeleton v-for="n in 5" :key="n" class="h-32 w-full" />
    </template>
    <template v-else>
      <NotificationsRuleRow
        v-for="kind in kinds"
        :key="kind.id"
        :kind="kind.id"
        :label="kind.label"
        :rule="rules[kind.id] ?? emptyNotificationRule"
        :hints="delivery.hints"
        :saving="saving === kind.id"
        :disabled="saving !== null"
        :server-error="errors[kind.id]"
        @save="save(kind.id, $event)"
      />
    </template>
  </div>
</template>
