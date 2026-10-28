import {
  projectBotsPath,
  projectTeamPath,
  type BotListResponse,
  type TeamMemberListResponse,
} from '@candy-mountain/shared'

export function useTeam() {
  const { slug } = useSelectedProject()
  const { $api } = useNuxtApp()

  const members = useAsyncData(
    () => teamDataKey(slug.value),
    () => (slug.value ? $api<TeamMemberListResponse>(projectTeamPath(slug.value)) : Promise.resolve({ members: [] })),
  )
  const bots = useAsyncData(
    () => teamBotsDataKey(slug.value),
    () => (slug.value ? $api<BotListResponse>(projectBotsPath(slug.value)) : Promise.resolve({ bots: [] })),
  )

  return {
    members: computed(() => members.data.value?.members ?? []),
    bots: computed(() => bots.data.value?.bots ?? []),
    status: members.status,
    error: computed(() => members.error.value ?? bots.error.value),
    refresh: () => Promise.all([members.refresh(), bots.refresh()]),
  }
}
