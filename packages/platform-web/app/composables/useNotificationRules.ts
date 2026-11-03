import {
  workspaceNotificationDeliveryPath,
  workspaceNotificationsPath,
  type NotificationDeliveryResponse,
  type NotificationKind,
  type NotificationRulesResponse,
  type UpdateNotificationRulesRequest,
} from '@candy-mountain/platform-sdk'

/** Notification rules and the channel that will deliver them; admin only, the daemon refuses others. */
export function useNotificationRules() {
  const { slug } = useSelectedProject()
  const { $api } = useNuxtApp()
  const toast = useToast()

  const rules = useApi<NotificationRulesResponse>(() => workspaceNotificationsPath(slug.value ?? ''), {
    key: computed(() => `notifications:rules:${slug.value ?? ''}`),
  })
  // Fetched apart from the rules so a failure here cannot hide them.
  const answer = useApi<NotificationDeliveryResponse>(() => workspaceNotificationDeliveryPath(slug.value ?? ''), {
    key: computed(() => `notifications:delivery:${slug.value ?? ''}`),
  })

  const delivery = computed(() => deliveryState(answer.data.value))
  const saving = ref<NotificationKind | null>(null)
  const errors = ref<Partial<Record<NotificationKind, string>>>({})

  async function save(kind: NotificationKind, draft: RuleDraft): Promise<boolean> {
    if (!slug.value || saving.value) return false
    saving.value = kind
    errors.value = { ...errors.value, [kind]: undefined }
    try {
      const body: UpdateNotificationRulesRequest = { rules: { [kind]: { enabled: draft.enabled, destination: draftDestination(draft) } } }
      rules.data.value = await $api<NotificationRulesResponse>(workspaceNotificationsPath(slug.value), { method: 'PUT', body })
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
    kinds: computed(() => rules.data.value?.kinds ?? []),
    rules: computed(() => rules.data.value?.rules ?? null),
    delivery,
    deliveryLoading: computed(() => answer.status.value === 'pending'),
    status: rules.status,
    error: rules.error,
    saving,
    errors,
    save,
    refresh: () => Promise.all([rules.refresh(), answer.refresh()]),
  }
}
