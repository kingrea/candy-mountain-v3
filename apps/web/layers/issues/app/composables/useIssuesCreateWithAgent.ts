/** "Create with Claude Code / Codex": a new thread seeded with the drafting prompt, shown in the chat panel. */
export function useIssuesCreateWithAgent() {
  const { registry } = useProjectRegistry()
  const { slug } = useSelectedProject()
  const threads = useChatThreads(slug)
  const panel = useChatPanel()
  const toast = useToast()

  const options = computed(() => issuesAgentCreateOptions(registry.value))
  const starting = ref(false)

  async function start(option: IssuesAgentCreateOption) {
    if (starting.value) return
    starting.value = true
    let threadId: string | null = null
    try {
      const created = await threads.create({ agentId: option.agentId, title: ISSUES_CREATE_THREAD_TITLE })
      threadId = created.thread.id
      // Open before prompting so a refused prompt still leaves the thread in view.
      panel.showThread(option.agentId, threadId)
      await threads.prompt(threadId, issuesSeedCreatePrompt(registry.value?.project.name ?? ''))
    }
    catch (cause) {
      toast.add({
        title: threadId ? 'Prompt not sent' : 'Chat not started',
        description: toApiError(cause).message,
        icon: 'i-lucide-circle-alert',
        color: 'error',
      })
    }
    finally {
      starting.value = false
    }
  }

  return { options, starting, start }
}
