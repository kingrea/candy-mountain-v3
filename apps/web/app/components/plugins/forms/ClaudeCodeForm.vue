<script setup lang="ts">
import {
  CLAUDE_CODE_TYPE_ACTIONS,
  CLAUDE_INSTALL_COMMAND,
  type ClaudeCodeAuthMode,
  type ClaudeExecutableResponse,
  type PluginInstance,
  type PluginInstanceResponse,
} from '@candy-mountain/shared'

const props = defineProps<PluginFormProps>()
const emit = defineEmits<PluginFormEmits>()

const { $api } = useNuxtApp()
const { slug } = useSelectedProject()
const { createPlugin, updatePlugin, testPlugin, pluginTypeAction } = usePluginActions()
const login = useClaudeCodeLogin()
const toast = useToast()

const isEdit = computed(() => props.instance !== null)
/** The instance this form works on: the one being edited, or the one created by the first action. */
const saved = ref<PluginInstance | null>(props.instance)
const created = ref(false)

// --- claude executable -------------------------------------------------------------------------------------------
const executable = ref<ClaudeExecutableState | null>(null)
const storedPath = typeof props.instance?.config.claudePath === 'string' ? props.instance.config.claudePath : ''
const customPath = ref(storedPath)
const showPathInput = ref(false)

async function checkExecutable(path?: string) {
  executable.value = { status: 'checking' }
  try {
    const result = await pluginTypeAction<ClaudeExecutableResponse>(props.type.id, CLAUDE_CODE_TYPE_ACTIONS.executable, { query: path ? { path } : undefined })
    executable.value = { status: 'checked', result, custom: Boolean(path) }
    if (result.found) showPathInput.value = false
  }
  catch (failure) {
    executable.value = { status: 'error', message: toApiError(failure).message }
  }
}

const checkCustomPath = () => checkExecutable(customPath.value.trim() || undefined)
const recheck = () => checkExecutable(executable.value?.status === 'checked' && executable.value.custom ? customPath.value.trim() : undefined)

onMounted(() => checkExecutable(storedPath || undefined))

const claudePath = computed(() => claudePathToSave(executable.value))
const executableReady = computed(() => claudePath.value !== null)
const summary = computed(() => (executable.value?.status === 'checked' ? claudeExecutableSummary(executable.value.result) : null))

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: `${what} copied`, icon: 'i-lucide-clipboard-check', color: 'success' })
  }
  catch {
    toast.add({ title: `Could not copy the ${what.toLowerCase()}`, icon: 'i-lucide-circle-alert', color: 'error' })
  }
}

// --- sign-in ---------------------------------------------------------------------------------------------------------
const mode = ref<ClaudeCodeAuthMode>(props.instance?.config.authMode === 'token' ? 'token' : 'login')
const token = ref('')
const tokenStored = computed(() => saved.value?.secrets.oauthToken === 'set')
const selectedMode = computed(() => CLAUDE_AUTH_MODE_OPTIONS.find(option => option.value === mode.value)!)

const busy = ref<'connect' | 'token' | null>(null)
const error = ref<ApiErrorInfo | null>(null)
const outcome = ref<ClaudeCodeLoginOutcome | null>(null)
const anyBusy = computed(() => busy.value !== null || login.busy.value !== null)

function selectMode(next: ClaudeCodeAuthMode) {
  if (mode.value === next) return
  mode.value = next
  error.value = null
  outcome.value = null
  login.clear()
}

/** Creates the instance on first use, or updates the stored one, with the chosen mode and executable. */
async function persist(secrets?: Record<string, string>): Promise<PluginInstance> {
  const path = claudePath.value ?? ''
  const current = saved.value
  const instance = current
    ? await updatePlugin(current.id, { config: { authMode: mode.value, claudePath: path || null }, secrets })
    : await createPlugin({
        type: props.type.id,
        scope: props.scope,
        project: props.scope === 'project' ? slug.value : null,
        config: path ? { authMode: mode.value, claudePath: path } : { authMode: mode.value },
        secrets,
      })
  if (!current) created.value = true
  saved.value = instance
  return instance
}

async function finish(instance: PluginInstance) {
  let fresh = instance
  try {
    fresh = (await $api<PluginInstanceResponse>(pluginInstancePath(instance.id))).instance
  }
  catch {
    // The list already refreshed; the stale copy only feeds the toast.
  }
  emit('saved', fresh, created.value)
}

async function connect() {
  error.value = null
  outcome.value = null
  busy.value = 'connect'
  try {
    const instance = await persist()
    const attempt = await login.start(instance.id)
    if (attempt) window.open(attempt.url, '_blank', 'noopener,noreferrer')
  }
  catch (failure) {
    error.value = toApiError(failure)
  }
  finally {
    busy.value = null
  }
}

async function submitCode() {
  const instance = saved.value
  if (!instance) return
  if (await login.submit(instance.id)) await finish(instance)
}

async function saveToken() {
  if (!claudeSetupReady('token', token.value, tokenStored.value)) return
  error.value = null
  outcome.value = null
  busy.value = 'token'
  try {
    const typed = token.value.trim()
    const instance = await persist(typed ? { oauthToken: typed } : undefined)
    token.value = ''
    // A config or secret change clears the stored health, so check the token straight away.
    const tested = await testPlugin(instance.id)
    if (tested.health?.healthy) {
      await finish(tested)
    }
    else {
      outcome.value = { color: 'error', title: 'The token was saved but Claude does not accept it.', description: tested.health && !tested.health.healthy ? tested.health.reason : undefined }
    }
  }
  catch (failure) {
    error.value = toApiError(failure)
  }
  finally {
    busy.value = null
  }
}

const shownError = computed(() => error.value ?? login.error.value)
const shownOutcome = computed(() => outcome.value ?? login.outcome.value)
</script>

<template>
  <div class="flex flex-col gap-5" data-testid="claude-code-form">
    <section class="flex flex-col gap-2" data-testid="claude-code-executable" :data-state="executable?.status ?? 'idle'">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-medium text-highlighted">
          claude executable
        </h3>
        <UButton
          v-if="executable?.status !== 'checking'"
          label="Check again"
          icon="i-lucide-refresh-cw"
          size="xs"
          color="neutral"
          variant="ghost"
          :disabled="anyBusy"
          data-testid="claude-code-executable-refresh"
          @click="recheck"
        />
      </div>

      <div v-if="!executable || executable.status === 'checking'" class="flex items-center gap-2 rounded-md bg-elevated/50 px-3 py-2 text-sm text-muted">
        <UIcon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin" />
        Looking for the claude executable on the daemon…
      </div>

      <UAlert
        v-else-if="executable.status === 'error'"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="The executable check did not run"
        :description="executable.message"
      />

      <div
        v-else-if="executable.result.found && summary"
        class="flex items-start gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success"
        data-testid="claude-code-executable-found"
      >
        <UIcon name="i-lucide-circle-check" class="mt-0.5 size-4 shrink-0" />
        <div class="min-w-0 flex-1">
          <p class="font-medium">
            {{ summary.title }}
          </p>
          <p class="truncate font-mono text-xs text-muted" :title="summary.detail">
            {{ summary.detail }}
          </p>
        </div>
      </div>

      <template v-else-if="summary">
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="summary.title"
          :description="summary.detail"
          data-testid="claude-code-executable-missing"
        />
        <div class="flex flex-col gap-2 rounded-md border border-default p-3">
          <p class="text-sm text-default">
            Install Claude Code on the machine running the daemon, then check again:
          </p>
          <div class="flex items-center gap-1">
            <code class="min-w-0 flex-1 truncate rounded-sm bg-elevated px-2 py-1 font-mono text-xs text-default" :title="CLAUDE_INSTALL_COMMAND">{{ CLAUDE_INSTALL_COMMAND }}</code>
            <UButton
              icon="i-lucide-copy"
              size="xs"
              color="neutral"
              variant="ghost"
              aria-label="Copy the install command"
              @click="copy(CLAUDE_INSTALL_COMMAND, 'Install command')"
            />
          </div>
        </div>
      </template>

      <div v-if="executable?.status === 'checked' && (!executable.result.found || showPathInput)" class="flex flex-col gap-1">
        <p class="text-xs text-muted">
          Already installed somewhere else? Enter the full path to the claude executable.
        </p>
        <form class="flex flex-col gap-2 sm:flex-row" @submit.prevent="checkCustomPath">
          <UInput
            v-model="customPath"
            placeholder="/usr/local/bin/claude"
            autocomplete="off"
            spellcheck="false"
            aria-label="Path to the claude executable"
            class="flex-1 font-mono"
            data-testid="claude-code-path"
          />
          <UButton
            type="submit"
            label="Check path"
            color="neutral"
            variant="outline"
            :disabled="!customPath.trim() || anyBusy"
            data-testid="claude-code-path-check"
          />
        </form>
      </div>
      <UButton
        v-else-if="executable?.status === 'checked' && executable.result.found"
        label="Use a different path"
        size="xs"
        color="neutral"
        variant="link"
        class="self-start px-0"
        data-testid="claude-code-path-toggle"
        @click="showPathInput = true"
      />
    </section>

    <USeparator />

    <section class="flex flex-col gap-3" data-testid="claude-code-sign-in">
      <h3 class="text-sm font-medium text-highlighted">
        Sign-in method
      </h3>
      <UFieldGroup class="w-full" data-testid="claude-code-mode">
        <UButton
          v-for="option in CLAUDE_AUTH_MODE_OPTIONS"
          :key="option.value"
          :label="option.label"
          :icon="option.icon"
          :color="mode === option.value ? 'primary' : 'neutral'"
          :variant="mode === option.value ? 'solid' : 'outline'"
          :aria-pressed="mode === option.value"
          :disabled="anyBusy"
          class="flex-1 justify-center"
          :data-mode="option.value"
          @click="selectMode(option.value)"
        />
      </UFieldGroup>
      <p class="text-sm text-muted">
        {{ selectedMode.description }}
      </p>

      <form v-if="mode === 'token'" class="flex flex-col gap-3" data-testid="claude-code-token-form" @submit.prevent="saveToken">
        <UFormField
          label="Long-lived token"
          :description="tokenStored ? 'A token is stored; leave this blank to keep it.' : 'Run `claude setup-token` on any machine with a browser and paste the token it prints.'"
          :required="!tokenStored"
        >
          <UInput
            v-model="token"
            type="password"
            autocomplete="new-password"
            spellcheck="false"
            :placeholder="tokenStored ? 'New token' : 'Paste the token'"
            class="w-full font-mono"
            data-testid="claude-code-token"
          />
        </UFormField>
        <UButton
          type="submit"
          :label="isEdit ? 'Save and test' : 'Add plugin'"
          icon="i-lucide-key-round"
          class="self-start"
          :loading="busy === 'token'"
          :disabled="!executableReady || !claudeSetupReady('token', token, tokenStored) || (anyBusy && busy !== 'token')"
          data-testid="claude-code-token-save"
        />
      </form>

      <template v-else>
        <UButton
          v-if="!login.attempt.value"
          label="Connect to Claude Code"
          icon="i-lucide-log-in"
          class="self-start"
          :loading="busy === 'connect' || login.busy.value === 'start'"
          :disabled="!executableReady || (anyBusy && busy !== 'connect' && login.busy.value !== 'start')"
          data-testid="claude-code-connect"
          @click="connect"
        />
        <p v-if="!executableReady && executable?.status === 'checked'" class="text-xs text-muted">
          Find or install the claude executable first.
        </p>

        <div v-if="login.attempt.value" class="flex flex-col gap-3 rounded-md border border-default p-3" data-testid="claude-code-attempt">
          <div class="flex flex-col gap-1">
            <p class="text-sm text-default">
              A Claude sign-in page opened in a new tab. Sign in there, then paste the code it shows below.
            </p>
            <div class="flex min-w-0 items-center gap-1">
              <ULink
                :to="login.attempt.value.url"
                target="_blank"
                rel="noopener noreferrer"
                external
                class="min-w-0 truncate font-mono text-sm text-primary"
                :title="login.attempt.value.url"
                data-testid="claude-code-url"
              >
                {{ login.attempt.value.url }}
              </ULink>
              <UButton
                icon="i-lucide-copy"
                size="xs"
                color="neutral"
                variant="ghost"
                aria-label="Copy the login link"
                @click="copy(login.attempt.value.url, 'Link')"
              />
            </div>
            <p class="text-xs text-muted" data-testid="claude-code-expiry">
              Expires in {{ login.remaining.value }}
            </p>
          </div>
          <form class="flex flex-col gap-2 sm:flex-row" @submit.prevent="submitCode">
            <UInput
              v-model="login.code.value"
              placeholder="Paste the code"
              autocomplete="off"
              aria-label="Login code"
              class="flex-1 font-mono"
              data-testid="claude-code-code"
            />
            <UButton
              type="submit"
              label="Submit code"
              :loading="login.busy.value === 'submit'"
              :disabled="!login.code.value.trim() || (anyBusy && login.busy.value !== 'submit')"
              data-testid="claude-code-submit"
            />
          </form>
        </div>
      </template>
    </section>

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
