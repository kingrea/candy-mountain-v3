<script setup lang="ts">
import { projectBotsPath, type Bot, type BotPersonaCheckResponse, type BotListResponse } from '@candy-mountain/shared'
import ProjectsConfirmModal from '~/components/projects/ProjectsConfirmModal.vue'

/** `null` opens the editor for a new bot, `undefined` closes it. */
const editing = defineModel<Bot | null | undefined>('editing')

const { $api } = useNuxtApp()
const { slug } = useSelectedProject()
const toast = useToast()
const confirm = useOverlay().create(ProjectsConfirmModal)

const { bots, data, status, error: loadError, refresh } = useBots()
const plugins = useBotsPlugins()

const actionError = ref<ApiErrorInfo | null>(null)
const checking = ref<string | null>(null)

const editorOpen = computed({
  get: () => editing.value !== undefined,
  set: (open) => {
    if (!open) editing.value = undefined
  },
})
// Kept while the editor closes so its title does not flip to "New bot" mid-animation.
const editorBot = ref<Bot | null>(null)
watch(editing, (bot) => {
  if (bot !== undefined) editorBot.value = bot
})
const defaultBranch = computed(() => botsRepositoryDefaultBranch(bots.value, plugins.instances.value))

function openCreate() {
  editing.value = null
}

function replaceBot(bot: Bot) {
  const list = data.value as BotListResponse | null | undefined
  if (list) list.bots = list.bots.map(candidate => (candidate.id === bot.id ? bot : candidate))
}

// The bots list drives the registry's hasBots fact, which gates the Team page.
async function afterChange() {
  await Promise.all([refresh(), refreshProjectRegistry(slug.value ?? undefined)])
}

async function recordPersonaCheck(bot: Bot): Promise<BotPersonaCheckResponse | null> {
  if (!slug.value) return null
  checking.value = bot.id
  try {
    const response = await $api<BotPersonaCheckResponse>(`${projectBotsPath(slug.value)}/${bot.id}/check-persona`, { method: 'POST' })
    replaceBot(response.bot)
    return response
  }
  catch (error) {
    actionError.value = toApiError(error)
    return null
  }
  finally {
    checking.value = null
  }
}

async function checkPersona(bot: Bot) {
  actionError.value = null
  const response = await recordPersonaCheck(bot)
  if (!response) return
  toast.add({
    title: response.status === 'verified' ? `Persona found for ${bot.name}` : `Persona missing for ${bot.name}`,
    description: response.reason ?? `Checked on ${response.branch}.`,
    color: response.status === 'verified' ? 'success' : 'warning',
  })
}

async function onSaved(bot: Bot, created: boolean) {
  actionError.value = null
  let saved = bot
  // A new or changed persona is unverified until checked, and an unverified persona keeps the bot from being active.
  if (bot.persona.name && bot.persona.status === 'unverified') {
    saved = (await recordPersonaCheck(bot))?.bot ?? bot
  }
  await afterChange()
  const view = botsStatusView(saved.status)
  toast.add({
    title: created ? `Created ${saved.name}` : `Saved ${saved.name}`,
    description: view.warnings.length ? view.warnings.join('; ') : view.label,
    color: view.warnings.length ? 'warning' : 'success',
  })
}

async function remove(bot: Bot) {
  const confirmed = await confirm.open({
    title: `Delete ${bot.name}?`,
    description: 'The bot and its Slack keys are deleted. The persona files in the repository are not touched.',
    confirmLabel: 'Delete bot',
  }).result
  if (!confirmed || !slug.value) return
  actionError.value = null
  try {
    await $api(`${projectBotsPath(slug.value)}/${bot.id}`, { method: 'DELETE' })
    toast.add({ title: `Deleted ${bot.name}`, color: 'success' })
  }
  catch (error) {
    actionError.value = toApiError(error)
  }
  await afterChange()
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <UAlert
      v-if="actionError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="actionError.message"
      :description="actionError.code"
      :close="{ onClick: () => { actionError = null } }"
      data-testid="action-error"
    />
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="Could not load bots"
      :description="toApiError(loadError).message"
    />

    <div v-if="status === 'pending' && !bots.length" class="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      <USkeleton v-for="n in 2" :key="n" class="h-72 w-full" />
    </div>
    <div v-else-if="bots.length" class="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3" data-testid="bot-cards">
      <BotsCard
        v-for="bot in bots"
        :key="bot.id"
        :bot="bot"
        :checking-persona="checking === bot.id"
        @edit="editing = $event"
        @delete="remove"
        @check-persona="checkPersona"
      />
    </div>
    <UEmpty
      v-else-if="!loadError"
      icon="i-lucide-bot"
      title="No bots yet"
      description="A bot answers in Slack with an agent working on this project's repository."
      :actions="[{ label: 'New bot', icon: 'i-lucide-plus', onClick: openCreate }]"
    />

    <BotsEditorModal
      v-model:open="editorOpen"
      :bot="editorBot"
      :family-reasons="plugins.familyReasons.value"
      :default-branch="defaultBranch"
      @saved="onSaved"
    />
  </div>
</template>
