import { projectRegistryPath, type RegistryResponse } from '@candy-mountain/shared'

export function useProjectRegistry() {
  const { slug } = useSelectedProject()
  const { $api } = useNuxtApp()

  const request = useAsyncData(
    () => projectRegistryKey(slug.value),
    () => (slug.value ? $api<RegistryResponse>(projectRegistryPath(slug.value)) : Promise.resolve(null)),
  )

  // Nuxt seeds a new key with the previous key's data until its fetch lands, which would show the last project's answer.
  const registry = computed(() => (request.data.value?.project.slug === slug.value ? request.data.value : null))

  return {
    registry,
    status: request.status,
    error: request.error,
    refresh: () => request.refresh(),
    loaded: request.then(() => undefined),
  }
}

/** Call after any setup change (modules, plugins, grants) so the sidebar and view gates re-read readiness. */
export function refreshProjectRegistry(slug?: string) {
  const current = slug ?? useRouter().currentRoute.value.params[PROJECT_ROUTE_PARAM]
  return refreshNuxtData(projectRegistryKey(typeof current === 'string' ? current : null))
}
