import {
  LIVE_VERSION_SOURCES_PATH,
  projectEnvironmentsPath,
  projectLiveVersionsPath,
  type EnvironmentLiveVersion,
  type EnvironmentListResponse,
  type LiveVersionSourceListResponse,
  type LiveVersionsResponse,
} from '@candy-mountain/shared'

export function useDeploymentsSources() {
  const request = useApi<LiveVersionSourceListResponse>(LIVE_VERSION_SOURCES_PATH, { key: DEPLOYMENTS_SOURCES_DATA_KEY })
  return { ...request, sources: computed(() => request.data.value?.sources ?? []) }
}

export function useDeploymentsEnvironments() {
  const { slug, project } = useSelectedProject()
  const { $api } = useNuxtApp()

  const request = useAsyncData(
    () => deploymentsEnvironmentsDataKey(slug.value),
    () => (slug.value ? $api<EnvironmentListResponse>(projectEnvironmentsPath(slug.value)) : Promise.resolve({ environments: [] })),
  )

  // Nuxt seeds a new key with the previous key's data, so another project's environments are filtered out.
  const environments = computed(() =>
    (request.data.value?.environments ?? []).filter(environment => environment.projectId === project.value?.id),
  )

  return { environments, status: request.status, error: request.error, refresh: () => request.refresh() }
}

/** Reading every source can take seconds, so this loads on the client after the page and the environment list. */
export function useDeploymentsLiveVersions() {
  const { slug } = useSelectedProject()
  const { $api } = useNuxtApp()

  const request = useAsyncData(
    () => deploymentsLiveDataKey(slug.value),
    () => (slug.value ? $api<LiveVersionsResponse>(projectLiveVersionsPath(slug.value)) : Promise.resolve({ environments: [] })),
    { server: false, lazy: true },
  )

  const byEnvironment = computed(() => {
    const entries = new Map<string, EnvironmentLiveVersion>()
    for (const entry of request.data.value?.environments ?? []) entries.set(entry.environmentId, entry)
    return entries
  })

  return { byEnvironment, status: request.status, error: request.error, refresh: () => request.refresh() }
}
