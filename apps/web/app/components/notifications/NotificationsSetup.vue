<script setup lang="ts">
import { NOTIFICATION_KINDS, type RegistryResponse } from '@candy-mountain/shared'

const props = defineProps<{ registry: RegistryResponse }>()

const { rules, identity, identityLoading, status, error, saving, errors, save, refresh } = useNotificationRules()

const pluginsTo = computed(() => projectPluginsPagePath(props.registry.project.slug))
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-6">
    <p class="text-sm text-muted">
      Send Slack messages from {{ registry.project.name }} when these events happen. Slack IDs, not names, identify where each one goes.
    </p>

    <UAlert
      v-if="!identityLoading"
      :color="identity.source === 'none' ? 'warning' : 'neutral'"
      variant="subtle"
      :icon="identity.source === 'none' ? 'i-lucide-triangle-alert' : 'i-lucide-slack'"
      data-testid="notification-identity"
      :data-source="identity.source"
      :title="identity.label"
      :description="identity.source === 'none'
        ? 'Add a Slack bot token to a project bot, or configure the Slack plugin, or deliveries will fail.'
        : 'Messages are sent as this identity.'"
      :actions="identity.source === 'none' ? [{ label: 'Set up Slack', to: pluginsTo, color: 'neutral', variant: 'outline' }] : undefined"
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
    <NotificationsRuleRow
      v-for="kind in NOTIFICATION_KINDS"
      v-else
      :key="kind"
      :kind="kind"
      :rule="rules[kind]"
      :saving="saving === kind"
      :disabled="saving !== null"
      :server-error="errors[kind]"
      @save="save(kind, $event)"
    />
  </div>
</template>
