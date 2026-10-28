<script setup lang="ts">
import {
  BOT_FAMILY_NAMES,
  BOT_SECRET_LABELS,
  BOT_SECRET_NAMES,
  BOT_WRITE_SCOPE_NAMES,
  type Bot,
} from '@candy-mountain/shared'
import type { BadgeProps } from '@nuxt/ui'

const props = defineProps<{
  bot: Bot
  checkingPersona?: boolean
}>()

const emit = defineEmits<{
  edit: [bot: Bot]
  delete: [bot: Bot]
  checkPersona: [bot: Bot]
}>()

const status = computed(() => botsStatusView(props.bot.status))

const baseBranch = computed(() => {
  const { baseBranch, effectiveBaseBranch } = props.bot
  if (baseBranch) return { name: baseBranch, note: null }
  return { name: effectiveBaseBranch, note: effectiveBaseBranch ? 'repository default' : 'repository default, unreadable' }
})

const PERSONA_BADGES: Record<Bot['persona']['status'], { label: string, color: BadgeProps['color'] }> = {
  verified: { label: 'Found', color: 'success' },
  missing: { label: 'Missing', color: 'error' },
  unverified: { label: 'Not checked', color: 'neutral' },
}

const answersIn = computed(() => ('channels' in props.bot.answersIn ? props.bot.answersIn.channels : null))
</script>

<template>
  <UCard :ui="{ body: 'flex flex-col gap-4' }" :data-testid="`bot-card-${bot.name}`" :data-status="typeof bot.status === 'string' ? bot.status : 'warnings'">
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <UIcon name="i-lucide-bot" class="size-5 shrink-0 text-muted" />
          <h3 class="truncate font-semibold text-highlighted">
            {{ bot.name }}
          </h3>
        </div>
        <UBadge
          :label="status.label"
          :color="status.color"
          :icon="status.icon"
          variant="subtle"
          data-testid="bot-status"
        />
      </div>
    </template>

    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      <dt class="text-muted">
        Agent
      </dt>
      <dd data-testid="bot-family">
        {{ BOT_FAMILY_NAMES[bot.family] }}
      </dd>

      <dt class="text-muted">
        Scope
      </dt>
      <dd data-testid="bot-scope">
        {{ BOT_WRITE_SCOPE_NAMES[bot.writeScope] }}
      </dd>

      <dt class="text-muted">
        Base branch
      </dt>
      <dd data-testid="bot-base-branch">
        <span v-if="baseBranch.name" class="font-mono">{{ baseBranch.name }}</span>
        <span v-if="baseBranch.note" class="text-muted"> ({{ baseBranch.note }})</span>
      </dd>

      <dt class="text-muted">
        Persona
      </dt>
      <dd class="flex flex-wrap items-center gap-1.5" data-testid="bot-persona">
        <template v-if="bot.persona.name">
          <span class="font-mono">{{ bot.persona.name }}</span>
          <UBadge v-bind="PERSONA_BADGES[bot.persona.status]" variant="subtle" size="sm" />
        </template>
        <span v-else class="text-muted">None</span>
      </dd>

      <dt class="text-muted">
        Answers in
      </dt>
      <dd data-testid="bot-answers-in">
        <span v-if="!answersIn">Anywhere</span>
        <span v-else class="flex flex-wrap gap-1">
          <UBadge v-for="channel in answersIn" :key="channel" :label="channel" color="neutral" variant="outline" size="sm" class="font-mono" />
        </span>
      </dd>

      <dt class="text-muted">
        Slack keys
      </dt>
      <dd class="flex flex-wrap gap-1" data-testid="bot-secrets">
        <UBadge
          v-for="secret in BOT_SECRET_NAMES"
          :key="secret"
          :label="BOT_SECRET_LABELS[secret]"
          :icon="bot.secrets[secret] === 'set' ? 'i-lucide-key-round' : 'i-lucide-circle-dashed'"
          :color="bot.secrets[secret] === 'set' ? 'success' : 'neutral'"
          variant="subtle"
          size="sm"
        />
      </dd>
    </dl>

    <BotsSlackConnection :bot="bot" />

    <ul v-if="status.warnings.length" class="flex flex-col gap-1 text-sm text-warning" data-testid="bot-warnings">
      <li v-for="warning in status.warnings" :key="warning" class="flex gap-1.5">
        <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" />
        <span>{{ warning }}</span>
      </li>
    </ul>
    <p v-else-if="bot.status === 'not_configured'" class="text-sm text-muted">
      Add the Slack keys and check the persona to make this bot usable.
    </p>

    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <UButton
          label="Check persona"
          icon="i-lucide-file-search"
          color="neutral"
          variant="ghost"
          size="sm"
          :loading="checkingPersona"
          :disabled="!bot.persona.name"
          data-testid="bot-check-persona"
          @click="emit('checkPersona', bot)"
        />
        <UButton label="Edit" icon="i-lucide-pencil" color="neutral" variant="outline" size="sm" data-testid="bot-edit" @click="emit('edit', bot)" />
        <UButton label="Delete" icon="i-lucide-trash-2" color="error" variant="soft" size="sm" data-testid="bot-delete" @click="emit('delete', bot)" />
      </div>
    </template>
  </UCard>
</template>
