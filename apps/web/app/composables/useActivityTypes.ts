import { ACTIVITY_TYPES_PATH, type ActivityEventType, type ActivityEventTypesResponse } from '@candy-mountain/shared'

/** The product's registered event types; fixed for the daemon's lifetime, so every caller shares one request. */
export function useActivityTypes() {
  const { data, status } = useApi<ActivityEventTypesResponse>(ACTIVITY_TYPES_PATH, { key: 'activity:types' })
  const types = computed(() => data.value?.types ?? [])
  return {
    types,
    /** False until the list arrives (or when it fails), so callers do not drop a filter they cannot check yet. */
    loaded: computed(() => status.value === 'success'),
    items: computed(() => activityTypeItems(types.value)),
    kind: (type: ActivityEventType) => activityEventKind(type, types.value),
  }
}
