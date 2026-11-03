<script setup lang="ts">
import type { RegistryResponse } from '@candy-mountain/shared'

const props = defineProps<{ registry: RegistryResponse }>()

const { kinds, rules, identity, identityLoading, status, error, saving, errors, save, refresh } = useNotificationRules()

const pluginsTo = computed(() => projectPluginsPagePath(props.registry.workspace.slug))
</script>

<template>
  <div class="flex max-w-3xl flex-col gap-6">
    <p class="text-sm text-muted">
      Send Slack messages from {{ registry.workspace.name }} when these events happen. Slack IDs, not names, identify where each one goes.
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
        ? `Add a Slack bot token to ${SCOPE.aSingular} bot, or configure the Slack plugin, or deliveries will fail.`
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
    <template v-else>
      <NotificationsRuleRow
        v-for="kind in kinds"
        :key="kind.id"
        :kind="kind.id"
        :label="kind.label"
        :rule="rules[kind.id] ?? emptyNotificationRule"
        :saving="saving === kind.id"
        :disabled="saving !== null"
        :server-error="errors[kind.id]"
        @save="save(kind.id, $event)"
      />
    </template>
  </div>
</template>
