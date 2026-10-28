import type { AgentSession, AgentSessionEvent, PlatformClientAction } from '@candy-mountain/shared'

/** Ledgers sit in shared state so a remounted panel or replayed stream never repeats an action; a reload starts from the session's activity instead. */
export function useChatClientActions(
  threadAgentId: MaybeRefOrGetter<string | null | undefined>,
  session: MaybeRefOrGetter<Pick<AgentSession, 'id' | 'lastActivityAt'> | null | undefined>,
  sessionRows: MaybeRefOrGetter<readonly AgentSessionEvent[]>,
) {
  const ledgers = useState<Record<string, ChatActionLedger>>('chat-client-actions', () => ({}))
  const { slug } = useSelectedProject()
  const { registry } = useProjectRegistry()
  const panel = useChatPanel()
  const threads = useChatThreads(slug)
  const toast = useToast()

  const applies = computed(() => chatActionsApply(toValue(threadAgentId)))
  const sessionId = computed(() => toValue(session)?.id ?? null)
  const ledger = computed(() => (sessionId.value ? ledgers.value[sessionId.value] : undefined))

  /** Starts the ledger before the first prompt of a thread created here, so its quick actions are not mistaken for replay. */
  function follow(current: Pick<AgentSession, 'id' | 'lastActivityAt'> | null | undefined) {
    if (current && !ledgers.value[current.id]) ledgers.value[current.id] = chatActionLedger(current)
  }

  async function perform(action: PlatformClientAction) {
    if (action.kind === 'navigate') {
      const path = chatNavigatePath(action, registry.value)
      const threadId = panel.state.value.threadId
      await navigateTo(threadId && action.projectSlug === slug.value ? chatThreadLink(threadId, path) : path)
      return
    }
    const threadId = action.threadId ?? (await threads.create({ agentId: action.agentId })).thread.id
    panel.showThread(action.agentId, threadId)
  }

  async function apply(id: string, { toolCallId, action }: ChatPendingAction) {
    const outcomes = ledgers.value[id]!.outcomes
    outcomes[toolCallId] = { state: 'applying' }
    try {
      await perform(action)
      outcomes[toolCallId] = { state: 'applied' }
    }
    catch (cause) {
      const message = toApiError(cause).message
      outcomes[toolCallId] = { state: 'failed', message }
      toast.add({ title: chatActionLabel(action, 'failed', registry.value), description: message, color: 'error', icon: 'i-lucide-circle-alert' })
    }
  }

  watch(() => toValue(session), follow, { immediate: true })

  watch([() => toValue(sessionRows).length, ledger, applies], () => {
    const id = sessionId.value
    if (!id) return
    for (const pending of chatActionsToApply(toValue(sessionRows), ledger.value, toValue(threadAgentId))) void apply(id, pending)
  }, { immediate: true })

  /** Only the current session's actions can have been applied here; earlier sessions' are history. */
  function stateOf(item: ChatActionItem): ChatActionState {
    if (!applies.value) return 'ignored'
    return item.session === CHAT_TRANSCRIPT_CURRENT ? chatActionState(item.toolCallId, ledger.value, true) : 'earlier'
  }

  return { follow, stateOf, applies }
}
