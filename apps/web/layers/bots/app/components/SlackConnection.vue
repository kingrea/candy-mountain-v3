<script setup lang="ts">
import type { Bot } from '@candy-mountain/shared'

const props = defineProps<{
  bot: Bot
}>()

const { slug } = useSelectedProject()
const { connection } = useBotsSlackConnection(slug, () => props.bot.id)
const view = computed(() => botsSlackView(props.bot, connection.value))
</script>

<template>
  <div class="empty:hidden" :data-bot-id="bot.id" data-testid="bot-slack-connection">
    <div v-if="view" class="flex flex-wrap items-center gap-2 text-sm" :data-state="view.label">
      <span class="text-muted">Slack</span>
      <UTooltip :text="view.detail ?? view.label" :disabled="!view.detail">
        <UBadge
          :label="view.label"
          :color="view.color"
          :icon="view.icon"
          variant="subtle"
          :ui="view.label === 'Connecting' ? { leadingIcon: 'animate-spin' } : undefined"
          data-testid="bot-slack-state"
        />
      </UTooltip>
      <span v-if="view.detail" class="min-w-0 break-words text-muted" data-testid="bot-slack-detail">{{ view.detail }}</span>
    </div>
  </div>
</template>
