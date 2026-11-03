import { WORKSPACES_PATH, type WorkspaceListResponse } from '@candy-mountain/platform-sdk'

export const PROJECTS_DATA_KEY = 'projects'
export const ALL_PROJECTS_DATA_KEY = 'projects:all'

export interface UseProjectsOptions {
  includeArchived?: boolean
}

export function useProjects(options: UseProjectsOptions = {}) {
  const includeArchived = options.includeArchived ?? false
  const result = useApi<WorkspaceListResponse>(WORKSPACES_PATH, {
    key: includeArchived ? ALL_PROJECTS_DATA_KEY : PROJECTS_DATA_KEY,
    query: includeArchived ? { includeArchived: 'true' } : undefined,
  })
  const projects = computed(() => result.data.value?.workspaces ?? [])
  return { ...result, projects }
}

// A project or organisation change can alter any project-scoped data on screen (the picker included), whatever its key.
export function refreshProjectData() {
  return refreshNuxtData()
}
