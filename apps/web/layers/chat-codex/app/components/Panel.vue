<script setup lang="ts">
import {
  CODEX_LOGIN_ACTIONS,
  type CodexLoginAttempt,
  type CodexLoginStatusResponse,
  type CodexRevokeResponse,
  type PluginInstance,
  type PluginTypeInfo,
} from '@candy-mountain/shared'
import ProjectsConfirmModal from '~/components/projects/ProjectsConfirmModal.vue'

const props = defineProps<{
  instance: PluginInstance
  type: PluginTypeInfo
}>()

const POLL_INTERVAL_MS = 2000

const { pluginAction, refreshPlugins } = usePluginActions()
const confirm = useOverlay().create(ProjectsConfirmModal)
const toast = useToast()

const healthy = computed(() => props.instance.health?.healthy === true)

const attempt = ref<CodexLoginAttempt | null>(null)
const error = ref<ApiErrorInfo | null>(null)
const revoked = ref(false)
const busy = ref<'start' | 'check' | 'revoke' | null>(null)

const open = computed(() => attempt.value?.status === 'starting' || attempt.value?.status === 'waiting')

const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
let poller: ReturnType<typeof setTimeout> | undefined
let unmounted = false
// Bumped by start and revoke so a status poll already in flight cannot bring back the attempt they replaced.
let generation = 0

const remaining = computed(() => {
  const ms = attempt.value ? Date.parse(attempt.value.expiresAt) - now.value : 0
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})

function schedulePoll() {
  clearTimeout(poller)
  if (open.value && !unmounted) poller = setTimeout(() => checkStatus(), POLL_INTERVAL_MS)
}

async function track(next: CodexLoginAttempt | null) {
  const wasOpen = open.value
  attempt.value = next
  // The daemon stores fresh health before it reports success, so a refresh is enough to show it.
  if (wasOpen && next?.status === 'succeeded') await refreshPlugins()
  schedulePoll()
}

async function checkStatus({ manual = false, resumeOnly = false } = {}) {
  clearTimeout(poller)
  const current = generation
  if (manual) busy.value = 'check'
  try {
    const { attempt: next } = await pluginAction<CodexLoginStatusResponse>(props.instance.id, CODEX_LOGIN_ACTIONS.status)
    if (unmounted || current !== generation) return
    error.value = null
    const resumable = next?.status === 'starting' || next?.status === 'waiting'
    await track(resumeOnly && !resumable ? null : next)
  }
  catch (failure) {
    if (current !== generation) return
    error.value = toApiError(failure)
    schedulePoll()
  }
  finally {
    if (manual) busy.value = null
  }
}

async function startLogin() {
  error.value = null
  revoked.value = false
  busy.value = 'start'
  generation++
  clearTimeout(poller)
  try {
    await track(await pluginAction<CodexLoginAttempt>(props.instance.id, CODEX_LOGIN_ACTIONS.start, { method: 'POST' }))
  }
  catch (failure) {
    error.value = toApiError(failure)
  }
  finally {
    busy.value = null
  }
}

async function revoke() {
  const confirmed = await confirm.open({
    title: 'Revoke the Codex login?',
    description: 'The project\'s Codex home is deleted. Chat and bots stop using Codex for this project until you log in again.',
    confirmLabel: 'Revoke',
  }).result
  if (!confirmed) return
  error.value = null
  busy.value = 'revoke'
  generation++
  clearTimeout(poller)
  try {
    await pluginAction<CodexRevokeResponse>(props.instance.id, CODEX_LOGIN_ACTIONS.revoke, { method: 'POST' })
    attempt.value = null
    revoked.value = true
  }
  catch (failure) {
    error.value = toApiError(failure)
    schedulePoll()
  }
  finally {
    busy.value = null
    await refreshPlugins()
  }
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

// Picks up an attempt still open from before a reload; never runs during SSR.
onMounted(() => {
  ticker = setInterval(() => { now.value = Date.now() }, 1000)
  checkStatus({ resumeOnly: true })
})
onBeforeUnmount(() => {
  unmounted = true
  clearInterval(ticker)
  clearTimeout(poller)
})
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="codex-panel">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-sm font-medium text-highlighted">
        Device login
      </h3>
      <div class="ml-auto flex flex-wrap items-center gap-1">
        <UButton
          v-if="!open"
          :label="healthy ? 'Log in again' : 'Start login'"
          icon="i-lucide-log-in"
          size="sm"
          :loading="busy === 'start'"
          :disabled="busy !== null && busy !== 'start'"
          data-testid="codex-start"
          @click="startLogin"
        />
        <UButton
          v-else
          label="Check status"
          icon="i-lucide-refresh-cw"
          size="sm"
          color="neutral"
          variant="outline"
          :loading="busy === 'check'"
          :disabled="busy !== null && busy !== 'check'"
          data-testid="codex-check"
          @click="checkStatus({ manual: true })"
        />
        <UButton
          label="Revoke"
          icon="i-lucide-log-out"
          size="sm"
          color="error"
          variant="ghost"
          :loading="busy === 'revoke'"
          :disabled="busy !== null && busy !== 'revoke'"
          data-testid="codex-revoke"
          @click="revoke"
        />
      </div>
    </div>

    <div v-if="open && attempt" class="flex flex-col gap-3 rounded-md border border-default p-3" data-testid="codex-attempt">
      <div class="flex flex-col gap-1">
        <p class="text-sm text-default">
          1. Open this link and sign in.
        </p>
        <div v-if="attempt.verificationUrl" class="flex min-w-0 items-center gap-1">
          <ULink
            :to="attempt.verificationUrl"
            target="_blank"
            rel="noopener noreferrer"
            external
            class="min-w-0 truncate font-mono text-sm text-primary"
            :title="attempt.verificationUrl"
            data-testid="codex-url"
          >
            {{ attempt.verificationUrl }}
          </ULink>
          <UButton
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Copy the login link"
            @click="copy(attempt.verificationUrl, 'Link')"
          />
        </div>
      </div>
      <div class="flex flex-col gap-1">
        <p class="text-sm text-default">
          2. Enter this one-time code.
        </p>
        <div v-if="attempt.userCode" class="flex items-center gap-1">
          <span class="font-mono text-lg font-semibold tracking-widest text-highlighted" data-testid="codex-code">{{ attempt.userCode }}</span>
          <UButton
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            aria-label="Copy the one-time code"
            @click="copy(attempt.userCode, 'Code')"
          />
        </div>
      </div>
      <p class="flex items-center gap-1.5 text-xs text-muted" data-testid="codex-waiting">
        <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
        Waiting for the browser; expires in {{ remaining }}
      </p>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="error.message"
      :description="error.code"
      data-testid="codex-error"
    />
    <UAlert
      v-else-if="attempt?.status === 'succeeded'"
      color="success"
      variant="subtle"
      icon="i-lucide-circle-check"
      title="Codex is logged in."
      data-outcome="success"
      data-testid="codex-outcome"
    />
    <UAlert
      v-else-if="attempt?.status === 'failed' || attempt?.status === 'expired'"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-x"
      :title="attempt.status === 'expired' ? 'The login expired; start it again.' : 'The login failed; start it again.'"
      :description="attempt.failure ?? undefined"
      data-outcome="error"
      data-testid="codex-outcome"
    />
    <UAlert
      v-else-if="revoked"
      color="info"
      variant="subtle"
      icon="i-lucide-info"
      title="The login was revoked."
      data-outcome="info"
      data-testid="codex-outcome"
    />
  </div>
</template>
