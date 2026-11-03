import { ORGANISATIONS_PATH, type OrganisationListResponse } from '@candy-mountain/platform-sdk'

export const ORGANISATIONS_DATA_KEY = 'organisations'

export function useOrganisations() {
  const result = useApi<OrganisationListResponse>(ORGANISATIONS_PATH, { key: ORGANISATIONS_DATA_KEY })
  const organisations = computed(() => result.data.value?.organisations ?? [])
  return { ...result, organisations }
}
