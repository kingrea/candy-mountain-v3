import { workspaceTemplateNotesPath, type TemplateNoteListResponse } from '../../src/wire'

/** Asks only while `enabled` holds, for callers outside the gate that must not hit the daemon's capability check. */
export function useTemplateNotes(enabled: () => boolean = () => true) {
  const { slug } = useSelectedProject()
  const { $api } = useNuxtApp()

  const request = useAsyncData(
    () => `template-notes:${enabled() ? slug.value ?? '' : ''}`,
    () => (slug.value && enabled() ? $api<TemplateNoteListResponse>(workspaceTemplateNotesPath(slug.value)) : Promise.resolve({ notes: [] })),
  )

  return {
    notes: computed(() => request.data.value?.notes ?? []),
    status: request.status,
    error: request.error,
    refresh: () => request.refresh(),
  }
}
