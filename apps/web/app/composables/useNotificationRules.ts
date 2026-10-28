import {
  PLUGINS_PATH,
  projectBotsPath,
  projectNotificationsPath,
  type Bot,
  type BotListResponse,
  type NotificationKind,
  type NotificationRulesResponse,
  type PluginInstanceListResponse,
  type UpdateNotificationRulesRequest,
} from '@candy-mountain/shared'

/** Notification rules and the Slack identity that will send them; admin only, the daemon refuses others. */
export function useNotificationRules() {
  const { slug } = useSelectedProject()
  const { $api } = useNuxtApp()
  const toast = useToast()

  const rules = useApi<NotificationRulesResponse>(() => projectNotificationsPath(slug.value ?? ''), {
    key: computed(() => `notifications:rules:${slug.value ?? ''}`),
  })
  // Bots and plugins only decide the identity line, so their failure must not hide the rules.
  const bots = useApi<BotListResponse>(() => projectBotsPath(slug.value ?? ''), {
    key: computed(() => `notifications:bots:${slug.value ?? ''}`),
  })
  const plugins = useApi<PluginInstanceListResponse>(PLUGINS_PATH, {
    key: computed(() => `notifications:plugins:${slug.value ?? ''}`),
    query: { project: slug },
  })

  const identity = computed(() => slackIdentity(
    bots.data.value?.bots as Bot[] | null ?? null,
    plugins.data.value?.instances ?? [],
  ))
  const saving = ref<NotificationKind | null>(null)
  const errors = ref<Partial<Record<NotificationKind, string>>>({})

  async function save(kind: NotificationKind, draft: RuleDraft): Promise<boolean> {
    if (!slug.value || saving.value) return false
    saving.value = kind
    errors.value = { ...errors.value, [kind]: undefined }
    try {
      const body: UpdateNotificationRulesRequest = { rules: { [kind]: { enabled: draft.enabled, destination: draftDestination(draft) } } }
      rules.data.value = await $api<NotificationRulesResponse>(projectNotificationsPath(slug.value), { method: 'PUT', body })
      toast.add({ title: 'Notification saved', color: 'success' })
      return true
    }
    catch (e) {
      errors.value = { ...errors.value, [kind]: toApiError(e).message }
      return false
    }
    finally {
      saving.value = null
    }
  }

  return {
    rules: computed(() => rules.data.value?.rules ?? null),
    identity,
    identityLoading: computed(() => bots.status.value === 'pending' || plugins.status.value === 'pending'),
    status: rules.status,
    error: rules.error,
    saving,
    errors,
    save,
    refresh: () => Promise.all([rules.refresh(), bots.refresh(), plugins.refresh()]),
  }
}
