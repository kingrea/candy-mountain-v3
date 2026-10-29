import { CLAUDE_CODE_ACTIONS, type ClaudeCodeStartLoginResponse, type ClaudeCodeSubmitCodeResponse } from '@candy-mountain/shared'

const ATTEMPT_GONE_CODES = ['claude_code_attempt_not_found', 'claude_code_attempt_not_waiting']

export interface ClaudeCodeLoginOutcome {
  color: 'success' | 'error' | 'info'
  title: string
  description?: string
}

/**
 * One browser-login attempt for a Claude Code instance: start it to get the sign-in link, then hand back the code
 * the browser shows. Shared by the add/edit form and the instance panel; call it from component setup.
 */
export function useClaudeCodeLogin() {
  const { pluginAction, refreshPlugins } = usePluginActions()

  const attempt = ref<ClaudeCodeStartLoginResponse | null>(null)
  const code = ref('')
  const busy = ref<'start' | 'submit' | null>(null)
  const error = ref<ApiErrorInfo | null>(null)
  const outcome = ref<ClaudeCodeLoginOutcome | null>(null)

  const now = ref(Date.now())
  let ticker: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    ticker = setInterval(() => { now.value = Date.now() }, 1000)
  })
  onBeforeUnmount(() => clearInterval(ticker))

  const remainingMs = computed(() => (attempt.value ? Date.parse(attempt.value.expiresAt) - now.value : 0))
  const remaining = computed(() => {
    const seconds = Math.max(0, Math.floor(remainingMs.value / 1000))
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  })

  watch(remainingMs, (ms) => {
    if (attempt.value && ms <= 0) {
      attempt.value = null
      outcome.value = { color: 'info', title: 'The login link expired; start the login again.' }
    }
  })

  function reset() {
    error.value = null
    outcome.value = null
  }

  function clear() {
    reset()
    attempt.value = null
    code.value = ''
  }

  /** Starts (or resumes) the instance's login; resolves with the attempt, or null when it failed (see `error`). */
  async function start(instanceId: string): Promise<ClaudeCodeStartLoginResponse | null> {
    reset()
    busy.value = 'start'
    try {
      attempt.value = await pluginAction<ClaudeCodeStartLoginResponse>(instanceId, CLAUDE_CODE_ACTIONS.startLogin, { method: 'POST' })
      code.value = ''
      return attempt.value
    }
    catch (failure) {
      error.value = toApiError(failure)
      return null
    }
    finally {
      busy.value = null
    }
  }

  /** Submits the pasted code; resolves true once the instance is logged in. */
  async function submit(instanceId: string): Promise<boolean> {
    if (!attempt.value || !code.value.trim()) return false
    reset()
    busy.value = 'submit'
    try {
      const result = await pluginAction<ClaudeCodeSubmitCodeResponse>(instanceId, CLAUDE_CODE_ACTIONS.submitCode, {
        method: 'POST',
        body: { attemptId: attempt.value.attemptId, code: code.value.trim() },
      })
      attempt.value = null
      code.value = ''
      outcome.value = result.status === 'logged_in'
        ? { color: 'success', title: 'Claude Code is logged in.' }
        : { color: 'error', title: 'The login failed; start it again.', description: result.reason }
      await refreshPlugins()
      return result.status === 'logged_in'
    }
    catch (failure) {
      error.value = toApiError(failure)
      if (ATTEMPT_GONE_CODES.includes(error.value.code)) attempt.value = null
      return false
    }
    finally {
      busy.value = null
    }
  }

  return { attempt, code, busy, error, outcome, remaining, reset, clear, start, submit }
}
