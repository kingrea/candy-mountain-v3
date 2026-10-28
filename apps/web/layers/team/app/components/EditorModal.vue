<script setup lang="ts">
import {
  projectTeamPath,
  SLACK_MEMBER_ID_PATTERN,
  TEAM_EMAIL_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  type Bot,
  type CreateTeamMemberRequest,
  type TeamMember,
  type TeamMemberResponse,
} from '@candy-mountain/shared'
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

const props = defineProps<{
  member: TeamMember | null
  bots: Bot[]
}>()

const emit = defineEmits<{
  saved: [member: TeamMember, created: boolean]
}>()

const open = defineModel<boolean>('open', { required: true })

const schema = z.object({
  displayName: z.string().trim().min(1, 'Name is required').max(TEAM_NAME_MAX_LENGTH, `At most ${TEAM_NAME_MAX_LENGTH} characters`),
  email: z.string().trim().max(TEAM_EMAIL_MAX_LENGTH, `At most ${TEAM_EMAIL_MAX_LENGTH} characters`)
    .refine(value => !value || z.email().safeParse(value).success, 'Not a valid email address'),
  slackMemberId: z.string().trim().min(1, 'Slack member id is required')
    .refine(value => SLACK_MEMBER_ID_PATTERN.test(value.toUpperCase()), 'Starts with U or W, then letters and digits, such as U0123ABCD'),
  scopeMode: z.enum(['all', 'bots']),
  botIds: z.array(z.string()),
})
type Schema = z.output<typeof schema>

const FIELD_FOR_CODE: Record<string, string> = {
  slack_member_taken: 'slackMemberId',
  unknown_bot: 'botIds',
}

const { $api } = useNuxtApp()
const { slug } = useSelectedProject()
const form = useTemplateRef('form')
const saving = ref(false)
const formError = ref<ApiErrorInfo | null>(null)

function initialState(): Schema {
  const member = props.member
  const scope = teamScopeToForm(member?.botScope, props.bots)
  return {
    displayName: member?.displayName ?? '',
    email: member?.email ?? '',
    slackMemberId: member?.slackMemberId ?? '',
    scopeMode: scope.mode,
    botIds: scope.botIds,
  }
}

const state = reactive<Schema>(initialState())

watch(() => [open.value, props.member] as const, ([isOpen]) => {
  if (!isOpen) return
  Object.assign(state, initialState())
  formError.value = null
}, { immediate: true })

const isEdit = computed(() => !!props.member)
const botItems = computed(() => props.bots.map(bot => ({ label: bot.name, value: bot.id })))
const modeItems = [
  { label: 'All bots', value: 'all', description: 'Includes bots added later.' },
  { label: 'Only these bots', value: 'bots' },
]

function body(data: Schema): CreateTeamMemberRequest {
  return {
    displayName: data.displayName,
    email: data.email || null,
    slackMemberId: data.slackMemberId.toUpperCase(),
    botScope: teamScopeFromForm(data.scopeMode, data.botIds),
  }
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (!slug.value) return
  formError.value = null
  saving.value = true
  const member = props.member
  try {
    const response = member
      ? await $api<TeamMemberResponse>(`${projectTeamPath(slug.value)}/${member.id}`, { method: 'PATCH', body: body(event.data) })
      : await $api<TeamMemberResponse>(projectTeamPath(slug.value), { method: 'POST', body: body(event.data) })
    emit('saved', response.member, !member)
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
    :title="isEdit ? `Edit ${member?.displayName}` : 'Add team member'"
    description="People on the roster can talk to the bots they are scoped to."
    :ui="{ footer: 'justify-end' }"
  >
    <template #body>
      <UForm
        id="team-form"
        ref="form"
        :schema="schema"
        :state="state"
        class="flex flex-col gap-5"
        data-testid="team-form"
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

        <UFormField name="displayName" label="Name" required>
          <UInput v-model="state.displayName" class="w-full" autofocus placeholder="Jack" data-testid="member-name" />
        </UFormField>

        <UFormField name="email" label="Email">
          <UInput v-model="state.email" type="email" class="w-full" placeholder="jack@example.com" data-testid="member-email" />
        </UFormField>

        <UFormField name="slackMemberId" label="Slack member id" description="From the member's Slack profile, under More, Copy member ID." required>
          <UInput v-model="state.slackMemberId" class="w-full font-mono" placeholder="U0123ABCD" data-testid="member-slack-id" />
        </UFormField>

        <UFormField name="scopeMode" label="Bots they may talk to">
          <URadioGroup v-model="state.scopeMode" :items="modeItems" data-testid="member-scope-mode" />
        </UFormField>

        <UFormField v-if="state.scopeMode === 'bots'" name="botIds" label="Bots">
          <USelectMenu
            v-model="state.botIds"
            :items="botItems"
            value-key="value"
            multiple
            class="w-full"
            placeholder="Select bots"
            data-testid="member-bots"
          />
          <template v-if="!botItems.length" #help>
            No bots to choose from.
          </template>
        </UFormField>
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton label="Cancel" color="neutral" variant="outline" @click="close" />
      <UButton
        type="submit"
        form="team-form"
        :label="isEdit ? 'Save' : 'Add member'"
        :loading="saving"
        data-testid="save-member"
      />
    </template>
  </UModal>
</template>
