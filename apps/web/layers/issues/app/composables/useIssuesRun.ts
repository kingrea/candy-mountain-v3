import { PLUGINS_PATH, type ChatThread, type PluginInstanceListResponse } from '@candy-mountain/shared'
import type { IssuesRunAgent } from '#layers/issues/app/utils/issues-run'

export interface IssuesRunStarted {
  thread: ChatThread
  agent: IssuesRunAgent
  ids: readonly string[]
}

/** Run issues with an agent: a new project thread whose first prompt names them, shown in the chat panel. */
export function useIssuesRun(slug: MaybeRefOrGetter<string | null>) {
  const { $api } = useNuxtApp()
  const { registry } = useProjectRegistry()
  const { types } = usePluginTypes()
  const threads = useChatThreads(slug)
  const panel = useChatPanel()
  const toast = useToast()

  const admin = computed(() => registry.value?.admin === true)

  // Client only: during SSR the registry may not have answered yet, which would cache a null list for an admin.
  const plugins = useAsyncData(
    () => `issues:run:plugins:${toValue(slug) ?? ''}`,
    async () => {
      const current = toValue(slug)
      if (!current || !admin.value) return null
      return (await $api<PluginInstanceListResponse>(PLUGINS_PATH, { query: { project: current } })).instances
    },
    { server: false, lazy: true, default: () => null, watch: [admin, registry] },
  )

  const repository = computed(() => issuesRunRepository({
    registry: registry.value,
    slug: toValue(slug),
    instances: plugins.error.value ? null : plugins.data.value,
    types: types.value,
    loading: admin.value && !plugins.error.value && plugins.data.value === null,
  }))

  const availability = computed(() => issuesRunAvailability(registry.value, repository.value))
  const starting = ref(false)

  async function run(ids: readonly string[], agent: IssuesRunAgent): Promise<IssuesRunStarted | null> {
    if (starting.value || ids.length === 0) return null
    starting.value = true
    let thread: ChatThread | null = null
    try {
      thread = (await threads.create({ agentId: agent.agentId, title: issuesRunThreadTitle(ids), issueIds: [...ids] })).thread
      // Open before prompting so a refused prompt still leaves the thread in view.
      panel.showThread(agent.agentId, thread.id)
      await threads.prompt(thread.id, issuesRunPrompt(ids))
      return { thread, agent, ids }
    }
    catch (cause) {
      toast.add({
        title: thread ? 'Prompt not sent' : 'Run not started',
        description: toApiError(cause).message,
        icon: 'i-lucide-circle-alert',
        color: 'error',
      })
      return null
    }
    finally {
      starting.value = false
    }
  }

  return { availability, starting, run }
}
