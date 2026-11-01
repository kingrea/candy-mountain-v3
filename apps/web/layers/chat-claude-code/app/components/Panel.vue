<script setup lang="ts">
import { CLAUDE_CODE_ACTIONS, type ClaudeCodeRevokeResponse, type PluginInstance, type PluginTypeInfo } from '@candy-mountain/shared'
import ProjectsConfirmModal from '~/components/projects/ProjectsConfirmModal.vue'

const props = defineProps<{
  instance: PluginInstance
  type: PluginTypeInfo
}>()

const { pluginAction, updatePlugin, testPlugin, refreshPlugins } = usePluginActions()
const login = useChatClaudeCodeLogin()
const confirm = useOverlay().create(ProjectsConfirmModal)
const toast = useToast()

const tokenMode = computed(() => props.instance.config.authMode === 'token')
const healthy = computed(() => props.instance.health?.healthy === true)

const { attempt, code, remaining } = login
const outcome = ref<ChatClaudeCodeLoginOutcome | null>(null)
const error = ref<ApiErrorInfo | null>(null)
const ownBusy = ref<'token' | 'revoke' | null>(null)
/** One busy flag for the template: the login composable's start/submit, or this panel's token/revoke. */
const busy = computed(() => ownBusy.value ?? login.busy.value)

const showTokenForm = ref(false)
const token = ref('')

const shownError = computed(() => error.value ?? login.error.value)
const shownOutcome = computed(() => outcome.value ?? login.outcome.value)

function reset() {
  error.value = null
  outcome.value = null
  login.reset()
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: `${what} copied`, icon: 'i-lucide-clipboard-check', color: 'success' })
  }
  catch {
    toast.add({ title: `Could not copy the ${what.toLowerCase()}`, icon: 'i-lucide-circle-alert', color: 'error' })
  }
}

async function startLogin() {
  reset()
  try {
    if (tokenMode.value) await updatePlugin(props.instance.id, { config: { authMode: 'login' } })
  }
  catch (failure) {
    error.value = toApiError(failure)
    return
  }
  if (await login.start(props.instance.id)) showTokenForm.value = false
}

async function submitCode() {
  reset()
  await login.submit(props.instance.id)
}

async function saveToken() {
  if (!token.value.trim()) return
  reset()
  ownBusy.value = 'token'
  try {
    await updatePlugin(props.instance.id, { config: { authMode: 'token' }, secrets: { oauthToken: token.value.trim() } })
    token.value = ''
    showTokenForm.value = false
    login.clear()
    // A config or secret change clears the stored health, so check the new token straight away.
    const { health } = await testPlugin(props.instance.id)
    outcome.value = health?.healthy
      ? { color: 'success', title: 'The token works; Claude Code is logged in.' }
      : { color: 'error', title: 'The token was saved but Claude does not accept it.', description: health && !health.healthy ? health.reason : undefined }
  }
  catch (failure) {
    error.value = toApiError(failure)
  }
  finally {
    ownBusy.value = null
  }
}

async function revoke() {
  const confirmed = await confirm.open({
    title: 'Revoke the Claude Code login?',
    description: 'The project\'s Claude config directory and any saved token are deleted. Chat and bots stop working for this project until you log in again.',
    confirmLabel: 'Revoke',
  }).result
  if (!confirmed) return
  reset()
  ownBusy.value = 'revoke'
  try {
    await pluginAction<ClaudeCodeRevokeResponse>(props.instance.id, CLAUDE_CODE_ACTIONS.revoke, { method: 'POST' })
    login.clear()
    outcome.value = { color: 'info', title: 'The login was revoked.' }
  }
  catch (failure) {
    error.value = toApiError(failure)
  }
  finally {
    ownBusy.value = null
    await refreshPlugins()
  }
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="claude-code-panel">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-sm font-medium text-highlighted">
        Sign-in
      </h3>
      <UBadge
        :label="tokenMode ? 'Long-lived token' : 'Browser login'"
        color="neutral"
        variant="subtle"
        size="sm"
        data-testid="claude-code-mode"
      />
      <div class="ml-auto flex flex-wrap items-center gap-1">
        <UButton
          v-if="!attempt"
          :label="tokenMode ? 'Switch to browser login' : healthy ? 'Log in again' : 'Start login'"
          icon="i-lucide-log-in"
          size="sm"
          :loading="busy === 'start'"
          :disabled="busy !== null && busy !== 'start'"
          data-testid="claude-code-start"
          @click="startLogin"
        />
        <UButton
          v-if="!showTokenForm"
          label="Paste a setup token"
          icon="i-lucide-key-round"
          size="sm"
          color="neutral"
          variant="outline"
          :disabled="busy !== null"
          data-testid="claude-code-token-toggle"
          @click="showTokenForm = true"
        />
        <UButton
          label="Revoke"
          icon="i-lucide-log-out"
          size="sm"
          color="error"
          variant="ghost"
          :loading="busy === 'revoke'"
          :disabled="busy !== null && busy !== 'revoke'"
          data-testid="claude-code-revoke"
          @click="revoke"
        />
      </div>
    </div>

    <div v-if="attempt" class="flex flex-col gap-3 rounded-md border border-default p-3" data-testid="claude-code-attempt">
      <div class="flex flex-col gap-1">
        <p class="text-sm text-default">
          Open this link, sign in, and paste the code the page shows.
        </p>
        <div class="flex min-w-0 items-center gap-1">
          <ULink
            :to="attempt.url"
            target="_blank"
            rel="noopener noreferrer"
            external
            class="min-w-0 truncate font-mono text-sm text-primary"
            :title="attempt.url"
            data-testid="claude-code-url"
          >
            {{ attempt.url }}
          </ULink>
          <UButton
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Copy the login link"
            @click="copy(attempt.url, 'Link')"
          />
        </div>
        <p class="text-xs text-muted" data-testid="claude-code-expiry">
          Expires in {{ remaining }}
        </p>
      </div>
      <form class="flex flex-col gap-2 sm:flex-row" @submit.prevent="submitCode">
        <UInput
          v-model="code"
          placeholder="Paste the code"
          autocomplete="off"
          aria-label="Login code"
          class="flex-1 font-mono"
          data-testid="claude-code-code"
        />
        <UButton
          type="submit"
          label="Submit code"
          :loading="busy === 'submit'"
          :disabled="!code.trim() || (busy !== null && busy !== 'submit')"
          data-testid="claude-code-submit"
        />
      </form>
    </div>

    <form
      v-if="showTokenForm"
      class="flex flex-col gap-2 rounded-md border border-default p-3"
      data-testid="claude-code-token-form"
      @submit.prevent="saveToken"
    >
      <p class="text-sm text-default">
        Run <code class="font-mono">claude setup-token</code> and paste the token it prints. It replaces the browser login for this project.
      </p>
      <div class="flex flex-col gap-2 sm:flex-row">
        <UInput
          v-model="token"
          type="password"
          placeholder="Long-lived token"
          autocomplete="new-password"
          aria-label="Long-lived token"
          class="flex-1"
          data-testid="claude-code-token"
        />
        <div class="flex gap-2">
          <UButton
            type="submit"
            label="Save and test"
            :loading="busy === 'token'"
            :disabled="!token.trim() || (busy !== null && busy !== 'token')"
            data-testid="claude-code-token-save"
          />
          <UButton
            label="Cancel"
            color="neutral"
            variant="outline"
            :disabled="busy === 'token'"
            @click="showTokenForm = false; token = ''"
          />
        </div>
      </div>
    </form>

    <UAlert
      v-if="shownError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="shownError.message"
      :description="shownError.code"
      data-testid="claude-code-error"
    />
    <UAlert
      v-else-if="shownOutcome"
      :color="shownOutcome.color"
      variant="subtle"
      :icon="shownOutcome.color === 'success' ? 'i-lucide-circle-check' : shownOutcome.color === 'error' ? 'i-lucide-circle-x' : 'i-lucide-info'"
      :title="shownOutcome.title"
      :description="shownOutcome.description"
      :data-outcome="shownOutcome.color"
      data-testid="claude-code-outcome"
    />
  </div>
</template>
