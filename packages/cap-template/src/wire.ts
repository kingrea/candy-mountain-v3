export const TEMPLATE_MANAGE_TOOL = 'template.manage'
export const TEMPLATE_NOTE_MAX_LENGTH = 500
export const workspaceTemplateNotesPath = (slug: string) => `/workspaces/${slug}/template/notes`

export interface TemplateNote {
  id: string
  workspaceId: string
  text: string
  createdAt: string
}

export interface CreateTemplateNoteRequest {
  text: string
}

export interface TemplateNoteListResponse {
  notes: TemplateNote[]
}

export interface TemplateNoteResponse {
  note: TemplateNote
}
