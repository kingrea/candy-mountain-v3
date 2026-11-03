import { repositoryPath, type Repository, type RepositoryResponse } from '@candy-mountain/platform-sdk'

export const repositoryDataKey = (slug: string) => `repository:${slug}`

/** The workspace's repository, or null when it has none; keyed by slug, so rows, cards and the form asking for one slug load it once. */
export function useRepository(slug: MaybeRefOrGetter<string | null>) {
  const { $api } = useNuxtApp()

  const request = useAsyncData(
    () => repositoryDataKey(toValue(slug) ?? ''),
    async (): Promise<Repository | null> => {
      const current = toValue(slug)
      if (!current) return null
      try {
        return (await $api<RepositoryResponse>(repositoryPath(current))).repository
      }
      catch (error) {
        if (toApiError(error).code === 'not_found') return null
        throw error
      }
    },
  )

  return {
    repository: computed(() => request.data.value ?? null),
    status: request.status,
    error: request.error,
    refresh: () => request.refresh(),
  }
}
