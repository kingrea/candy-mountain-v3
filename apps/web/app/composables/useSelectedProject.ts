import {
  ORGANISATIONS_PATH,
  PROJECTS_PATH,
  type OrganisationListResponse,
  type ProjectListResponse,
} from '@candy-mountain/shared'

export const PROJECT_DIRECTORY_KEYS = ['project-directory:projects', 'project-directory:organisations']

export function useProjectDirectory() {
  const projectsRequest = useApi<ProjectListResponse>(PROJECTS_PATH, { key: PROJECT_DIRECTORY_KEYS[0] })
  const organisationsRequest = useApi<OrganisationListResponse>(ORGANISATIONS_PATH, { key: PROJECT_DIRECTORY_KEYS[1] })

  const projects = computed(() => projectsRequest.data.value?.projects ?? [])
  const organisations = computed(() => organisationsRequest.data.value?.organisations ?? [])
  const groups = computed(() => groupProjectsByOrganisation(projects.value, organisations.value))
  const status = computed(() => {
    const statuses = [projectsRequest.status.value, organisationsRequest.status.value]
    if (statuses.includes('error')) return 'error'
    if (statuses.every(value => value === 'success')) return 'success'
    return 'pending'
  })

  return {
    projects,
    organisations,
    groups,
    status,
    loaded: Promise.all([projectsRequest, organisationsRequest]).then(() => undefined),
    refresh: () => refreshNuxtData(PROJECT_DIRECTORY_KEYS),
  }
}

export function useLastProjectSlug() {
  return useCookie<string | null>(LAST_PROJECT_COOKIE, {
    default: () => null,
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    path: '/',
  })
}

export function useSelectedProject() {
  const route = useRoute()
  const directory = useProjectDirectory()

  const slug = computed(() => {
    const value = (route.params as Record<string, unknown>)[PROJECT_ROUTE_PARAM]
    return typeof value === 'string' ? value : null
  })
  const project = computed(() => directory.projects.value.find(candidate => candidate.slug === slug.value) ?? null)

  function switchPath(target: string) {
    return projectSwitchPath(route.matched.at(-1)?.path, target)
  }

  return {
    slug,
    project,
    ...directory,
    switchPath,
    select: (target: string) => navigateTo(switchPath(target)),
  }
}
