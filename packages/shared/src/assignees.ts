export const projectAssigneesPath = (slug: string) => `/projects/${slug}/assignees`

export const ASSIGNEE_NAME_MAX_LENGTH = 100

export interface ProjectAssignee {
  name: string
}

export interface ProjectAssigneesResponse {
  assignees: ProjectAssignee[]
}

export interface AddAssigneeRequest {
  name: string
}

export interface AddAssigneeResponse {
  assignee: ProjectAssignee
}

export const ASSIGNEE_ERROR_CODES = ['invalid_request'] as const
export type AssigneeErrorCode = (typeof ASSIGNEE_ERROR_CODES)[number]
