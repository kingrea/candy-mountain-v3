import type { Organisation, Project } from '@candy-mountain/shared'

export const PROJECT_ROUTE_PREFIX = '/p'
export const PROJECT_ROUTE_PARAM = 'project'
export const PROJECTS_PAGE_PATH = '/projects'
export const LAST_PROJECT_COOKIE = 'cm-last-project'
export const PROJECT_PICKER_SEARCH_THRESHOLD = 8
export const UNGROUPED_LABEL = 'Ungrouped'

export interface ProjectGroup {
  organisation: Organisation | null
  projects: Project[]
}

export type ProjectPickerItem =
  | { type: 'label', label: string, value?: undefined, color?: undefined }
  | { type: 'item', label: string, value: string, color: string }

function byNameThenSlug(a: { name: string, slug: string }, b: { name: string, slug: string }) {
  return a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug)
}

export function groupProjectsByOrganisation(
  projects: readonly Project[],
  organisations: readonly Organisation[],
): ProjectGroup[] {
  const visible = projects.filter(project => !project.archived).sort(byNameThenSlug)
  const knownIds = new Set(organisations.map(organisation => organisation.id))

  const groups: ProjectGroup[] = [...organisations]
    .sort(byNameThenSlug)
    .map(organisation => ({
      organisation,
      projects: visible.filter(project => project.organisationId === organisation.id),
    }))
    .filter(group => group.projects.length > 0)

  const ungrouped = visible.filter(project => !project.organisationId || !knownIds.has(project.organisationId))
  if (ungrouped.length > 0) groups.push({ organisation: null, projects: ungrouped })
  return groups
}

export function projectPickerItems(groups: readonly ProjectGroup[]): ProjectPickerItem[][] {
  const onlyUngrouped = groups.length === 1 && groups[0]?.organisation === null
  return groups.map((group) => {
    const options: ProjectPickerItem[] = group.projects.map(project => ({
      type: 'item',
      label: project.name,
      value: project.slug,
      color: project.color,
    }))
    if (onlyUngrouped) return options
    return [{ type: 'label', label: group.organisation?.name ?? UNGROUPED_LABEL }, ...options]
  })
}

export function projectPath(slug: string, ...segments: string[]): string {
  return [PROJECT_ROUTE_PREFIX, encodeURIComponent(slug), ...segments].join('/')
}

const PROJECT_PARAM_SEGMENT = new RegExp(`^:${PROJECT_ROUTE_PARAM}(?:\\(|$)`)

// Stops at the first dynamic segment after the slug because item ids (an issue, a session) belong to the old project.
export function projectSwitchPath(routePattern: string | undefined, slug: string): string {
  const segments = (routePattern ?? '').split('/').filter(Boolean)
  const paramIndex = segments.findIndex(segment => PROJECT_PARAM_SEGMENT.test(segment))
  if (paramIndex === -1) return projectPath(slug)

  const pageSegments: string[] = []
  for (const segment of segments.slice(paramIndex + 1)) {
    if (segment.includes(':')) break
    pageSegments.push(segment)
  }
  return projectPath(slug, ...pageSegments)
}
