<script setup lang="ts">
import {
  BOT_BASE_BRANCH_PATTERN,
  BOT_FAMILIES,
  BOT_NAME_MAX_LENGTH,
  BOT_PERSONA_NAME_PATTERN,
  BOT_SECRET_LABELS,
  BOT_SECRET_NAMES,
  BOT_SECRET_PREFIXES,
  BOT_WRITE_SCOPE_NAMES,
  BOT_WRITE_SCOPES,
  projectBotsPath,
  SLACK_CHANNEL_ID_PATTERN,
  type Bot,
  type BotAnswersIn,
  type BotFamily,
  type BotPersonaPreviewRequest,
  type BotPersonaPreviewResponse,
  type BotResponse,
  type BotSecretName,
  type BotSecretValues,
  type CreateBotRequest,
  type UpdateBotRequest,
} from '@candy-mountain/shared'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'
import type { BotsPersonaCheck } from '../utils/bots'

const props = defineProps<{
  bot: Bot | null
  familyReasons: Record<BotFamily, string | null>
  defaultBranch: string | null
}>()

const emit = defineEmits<{
  saved: [bot: Bot, created: boolean]
}>()

const open = defineModel<boolean>('open', { required: true })

const secretSchema = (name: BotSecretName) => z.string().trim().refine(
  value => !value || value.startsWith(BOT_SECRET_PREFIXES[name]),
  `${BOT_SECRET_LABELS[name]}s start with ${BOT_SECRET_PREFIXES[name]}`,
)

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(BOT_NAME_MAX_LENGTH, `At most ${BOT_NAME_MAX_LENGTH} characters`),
  slackBotToken: secretSchema('slackBotToken'),
  slackAppToken: secretSchema('slackAppToken'),
  family: z.enum(BOT_FAMILIES),
  writeScope: z.enum(BOT_WRITE_SCOPES),
  baseBranch: z.string().trim().refine(value => !value || BOT_BASE_BRANCH_PATTERN.test(value), 'Not a valid branch name'),
  personaName: z.string().trim().refine(value => !value || BOT_PERSONA_NAME_PATTERN.test(value), 'Letters, digits, dots, underscores and hyphens, up to 64 characters'),
  answersMode: z.enum(['anywhere', 'channels']),
  channels: z.array(z.string()),
}).superRefine((data, context) => {
  if (data.answersMode !== 'channels') return
  if (!data.channels.length) context.addIssue({ code: 'custom', path: ['channels'], message: 'Add at least one channel, or answer anywhere' })
  const seen = new Set<string>()
  data.channels.forEach((raw, index) => {
    const id = channelId(raw)
    if (!SLACK_CHANNEL_ID_PATTERN.test(id)) context.addIssue({ code: 'custom', path: ['channels', index], message: 'A channel id looks like C0123ABCD' })
    else if (seen.has(id)) context.addIssue({ code: 'custom', path: ['channels', index], message: 'Already listed' })
    seen.add(id)
  })
})
type Schema = z.output<typeof schema>

const { $api } = useNuxtApp()
const { slug } = useSelectedProject()
const form = useTemplateRef('form')
const isEdit = computed(() => props.bot !== null)
const state = reactive<Schema>(initialState())
const saving = ref(false)
const formError = ref<ApiErrorInfo | null>(null)

function channelId(raw: string) {
  return raw.trim().toUpperCase()
}

function firstAvailableFamily(): BotFamily {
  return BOT_FAMILIES.find(family => props.familyReasons[family] === null) ?? BOT_FAMILIES[0]
}

function initialState(): Schema {
  const bot = props.bot
  return {
    name: bot?.name ?? '',
    slackBotToken: '',
    slackAppToken: '',
    family: bot?.family ?? firstAvailableFamily(),
    writeScope: bot?.writeScope ?? 'read-only',
    baseBranch: bot?.baseBranch ?? '',
    personaName: bot?.persona.name ?? '',
    answersMode: bot && 'channels' in bot.answersIn ? 'channels' : 'anywhere',
    channels: bot && 'channels' in bot.answersIn ? [...bot.answersIn.channels] : [],
  }
}

const personaCheck = ref<(BotsPersonaCheck & { baseBranch: string }) | null>(null)
const personaChecking = ref(false)
const personaError = ref<ApiErrorInfo | null>(null)
let personaRequest = 0

const personaNameValid = computed(() => BOT_PERSONA_NAME_PATTERN.test(state.personaName.trim()))

function resetPersonaCheck() {
  personaRequest++
  personaCheck.value = null
  personaChecking.value = false
  personaError.value = null
}

watch(() => [state.personaName.trim(), state.baseBranch.trim()], resetPersonaCheck)

async function checkPersona() {
  if (!slug.value || !personaNameValid.value) return
  const request = ++personaRequest
  const personaName = state.personaName.trim()
  const baseBranch = state.baseBranch.trim()
  personaChecking.value = true
  personaError.value = null
  try {
    const body: BotPersonaPreviewRequest = { personaName, baseBranch: baseBranch || null }
    const files = await $api<BotPersonaPreviewResponse>(`${projectBotsPath(slug.value)}/check-persona`, { method: 'POST', body })
    if (request !== personaRequest) return
    personaCheck.value = { personaName, baseBranch, files }
  }
  catch (error) {
    if (request === personaRequest) personaError.value = toApiError(error)
  }
  finally {
    if (request === personaRequest) personaChecking.value = false
  }
}

const branchPlaceholder = computed(() => {
  const known = personaCheck.value && !personaCheck.value.baseBranch ? personaCheck.value.files.branch : props.defaultBranch
  return known ? `${known} (repository default)` : 'Repository default'
})

const familyOptions = computed(() => botsFamilyOptions({
  pluginReasons: props.familyReasons,
  personaCheck: personaCheck.value,
  currentFamily: props.bot?.family,
}))

const storedPersona = computed(() => {
  const persona = props.bot?.persona
  if (!persona?.name || persona.name !== state.personaName.trim() || (props.bot?.baseBranch ?? '') !== state.baseBranch.trim()) return null
  if (persona.status === 'verified') return { color: 'text-success', text: 'Found when last checked.' }
  if (persona.status === 'missing') return { color: 'text-warning', text: persona.reason ?? 'Not found when last checked.' }
  return { color: 'text-muted', text: 'Not checked yet.' }
})

const writeScopeItems = BOT_WRITE_SCOPES.map(scope => ({ label: BOT_WRITE_SCOPE_NAMES[scope], value: scope }))
const answersItems = [
  { label: 'Anywhere', value: 'anywhere', description: 'Any channel or direct message the bot is in.' },
  { label: 'Only in these channels', value: 'channels' },
]

watch(() => state.answersMode, (mode) => {
  if (mode === 'channels' && !state.channels.length) state.channels.push('')
})

function addChannel() {
  state.channels.push('')
}

function removeChannel(index: number) {
  state.channels.splice(index, 1)
}

watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(state, initialState())
  formError.value = null
  resetPersonaCheck()
}, { immediate: true })

function answersIn(data: Schema): BotAnswersIn {
  return data.answersMode === 'anywhere' ? { anywhere: true } : { channels: data.channels.map(channelId) }
}

function secrets(data: Schema): BotSecretValues | undefined {
  const values: BotSecretValues = {}
  for (const name of BOT_SECRET_NAMES) {
    if (data[name]) values[name] = data[name]
  }
  return Object.keys(values).length ? values : undefined
}

function createBody(data: Schema): CreateBotRequest {
  return {
    name: data.name,
    family: data.family,
    writeScope: data.writeScope,
    baseBranch: data.baseBranch || null,
    personaName: data.personaName || null,
    answersIn: answersIn(data),
    secrets: secrets(data),
  }
}

function updateBody(data: Schema, bot: Bot): UpdateBotRequest {
  const body: UpdateBotRequest = {}
  if (data.name !== bot.name) body.name = data.name
  if (data.family !== bot.family) body.family = data.family
  if (data.writeScope !== bot.writeScope) body.writeScope = data.writeScope
  if ((data.baseBranch || null) !== bot.baseBranch) body.baseBranch = data.baseBranch || null
  if ((data.personaName || null) !== bot.persona.name) body.personaName = data.personaName || null
  const nextAnswersIn = answersIn(data)
  if (JSON.stringify(nextAnswersIn) !== JSON.stringify(bot.answersIn)) body.answersIn = nextAnswersIn
  const nextSecrets = secrets(data)
  if (nextSecrets) body.secrets = nextSecrets
  return body
}

const FIELD_FOR_CODE: Partial<Record<string, keyof Schema>> = {
  name_taken: 'name',
  family_unavailable: 'family',
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  formError.value = null
  const family = familyOptions.value.find(option => option.value === event.data.family)
  if (family?.disabled) {
    form.value?.setErrors([{ name: 'family', message: family.description ?? `${family.label} cannot be chosen` }])
    return
  }
  if (!slug.value) return
  saving.value = true
  const bot = props.bot
  try {
    const response = bot
      ? await $api<BotResponse>(`${projectBotsPath(slug.value)}/${bot.id}`, { method: 'PATCH', body: updateBody(event.data, bot) })
      : await $api<BotResponse>(projectBotsPath(slug.value), { method: 'POST', body: createBody(event.data) })
    emit('saved', response.bot, !bot)
    open.value = false
  }
  catch (error) {
    const apiError = toApiError(error)
    const field = FIELD_FOR_CODE[apiError.code]
    if (field) form.value?.setErrors([{ name: field, message: apiError.message }])
    else formError.value = apiError
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="isEdit ? `Edit ${bot?.name}` : 'New bot'"
    :description="isEdit ? 'Changing the persona, family or base branch means the persona is checked again.' : 'A Slack bot that runs an agent against this project.'"
    :ui="{ footer: 'justify-end', content: 'sm:max-w-xl' }"
  >
    <template #body>
      <UForm
        id="bot-form"
        ref="form"
        :schema="schema"
        :state="state"
        class="flex flex-col gap-5"
        data-testid="bot-form"
        @submit="onSubmit"
      >
        <UAlert
          v-if="formError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="formError.message"
          :description="formError.code"
          data-testid="form-error"
        />

        <UFormField name="name" label="Name" required>
          <UInput v-model="state.name" class="w-full" autofocus placeholder="Ana" data-testid="bot-name" />
        </UFormField>

        <UFormField
          v-for="secret in BOT_SECRET_NAMES"
          :key="secret"
          :name="secret"
          :label="BOT_SECRET_LABELS[secret]"
          :description="bot?.secrets[secret] === 'set' ? 'Set. Leave blank to keep it, or paste a new one to replace it.' : undefined"
        >
          <template v-if="bot?.secrets[secret] === 'set'" #hint>
            <UBadge label="Set" color="success" variant="subtle" size="sm" icon="i-lucide-key-round" :data-testid="`secret-set-${secret}`" />
          </template>
          <UInput
            v-model="state[secret]"
            type="password"
            autocomplete="off"
            class="w-full font-mono"
            :placeholder="bot?.secrets[secret] === 'set' ? '••••••••' : `${BOT_SECRET_PREFIXES[secret]}…`"
            :data-testid="`secret-${secret}`"
          />
        </UFormField>

        <UFormField name="personaName" label="Persona" description="The agent file's name, without .md. Checked on the base branch.">
          <div class="flex gap-2">
            <UInput
              v-model="state.personaName"
              class="w-full font-mono"
              placeholder="ana"
              data-testid="persona-name"
            />
            <UButton
              label="Check persona"
              icon="i-lucide-file-search"
              color="neutral"
              variant="outline"
              :loading="personaChecking"
              :disabled="!personaNameValid"
              data-testid="check-persona"
              @click="checkPersona"
            />
          </div>
          <template #help>
            <div class="min-h-5" data-testid="persona-result">
              <span v-if="personaChecking" class="text-muted">Looking for the persona files…</span>
              <span v-else-if="personaError" class="text-error">{{ personaError.message }}</span>
              <BotsPersonaFiles v-else-if="personaCheck" :check="personaCheck" />
              <span v-else-if="storedPersona" :class="storedPersona.color">{{ storedPersona.text }}</span>
            </div>
          </template>
        </UFormField>

        <UFormField name="family" label="Agent" required>
          <URadioGroup
            v-model="state.family"
            :items="familyOptions"
            variant="table"
            data-testid="bot-family"
          />
        </UFormField>

        <UFormField name="writeScope" label="Write scope" required>
          <USelect v-model="state.writeScope" :items="writeScopeItems" class="w-full" data-testid="bot-write-scope" />
        </UFormField>

        <UFormField name="baseBranch" label="Base branch" description="Work starts from this branch and pull requests target it. Leave blank to follow the repository default.">
          <UInput v-model="state.baseBranch" class="w-full font-mono" :placeholder="branchPlaceholder" data-testid="bot-base-branch" />
        </UFormField>

        <UFormField name="answersMode" label="Answers in">
          <URadioGroup v-model="state.answersMode" :items="answersItems" data-testid="bot-answers-mode" />
        </UFormField>

        <UFormField
          v-if="state.answersMode === 'channels'"
          name="channels"
          label="Channel ids"
          description="One Slack channel id per field, such as C0123ABCD."
        >
          <!-- In the label row so an error appearing on blur cannot shift it out from under the click. -->
          <template #hint>
            <UButton
              label="Add channel"
              icon="i-lucide-plus"
              color="neutral"
              variant="outline"
              size="xs"
              data-testid="add-channel"
              @click="addChannel"
            />
          </template>
          <div class="flex flex-col gap-2" data-testid="bot-channels">
            <UFormField v-for="(_, index) in state.channels" :key="index" :name="`channels.${index}`">
              <div class="flex gap-2">
                <UInput
                  v-model="state.channels[index]"
                  class="w-full font-mono"
                  placeholder="C0123ABCD"
                  :aria-label="`Channel id ${index + 1}`"
                  :data-testid="`bot-channel-${index}`"
                />
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  :aria-label="`Remove channel ${index + 1}`"
                  :data-testid="`remove-channel-${index}`"
                  @click="removeChannel(index)"
                />
              </div>
            </UFormField>
          </div>
        </UFormField>
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton label="Cancel" color="neutral" variant="outline" @click="close" />
      <UButton
        type="submit"
        form="bot-form"
        :label="isEdit ? 'Save' : 'Create bot'"
        :loading="saving"
        data-testid="save-bot"
      />
    </template>
  </UModal>
</template>
