import type { CreateWorkspaceRequest, Workspace } from '@candy-mountain/shared'
import { markRaw, type Component } from 'vue'
import type * as z from 'zod'

/** Props a contributed field component receives; it binds its value with v-model and renders its own UFormField. */
export interface ProjectFormFieldProps {
  /** Null while creating. */
  project: Workspace | null
  open: boolean
}

/** What a field adds to the save toast; the first note that sets a colour sets the toast's colour. */
export interface ProjectFormSaveNote {
  description?: string
  color?: 'success' | 'warning' | 'error' | 'neutral'
}

/**
 * A field a layer adds to the create/edit form, after core's own fields. Its value lives in the form state under
 * `name`, validates with `schema` alongside core's fields, and its component renders `<UFormField :name>` itself.
 */
export interface ProjectFormField<T = unknown> {
  /** The state key and the UFormField name; unique across fields, registering it again replaces the earlier field. */
  name: string
  component: Component
  schema: z.ZodType<T>
  initial: (project: Workspace | null) => T
  /** Body fields merged into the create (project null) or update request. */
  request?: (value: T, project: Workspace | null) => Partial<CreateWorkspaceRequest>
  /** API error codes shown on this field instead of above the form. */
  errorCodes?: readonly string[]
  /** Runs after the create or update succeeded, with the saved project; a throw is shown as the form's error. */
  afterSave?: (project: Workspace, context: { value: T, created: boolean }) => ProjectFormSaveNote | undefined | Promise<ProjectFormSaveNote | undefined>
  /** The modal's description; the first field that sets one wins. */
  description?: { create: string, edit: string }
}

const projectFormFieldsByName = new Map<string, ProjectFormField>()

/**
 * Adds a field to the project form. Call it from the Nuxt plugin of the layer that owns the field, with
 * defineAsyncComponent so the field loads lazily. Fields render in registration order.
 */
export function registerProjectFormField<T>(field: ProjectFormField<T>): void {
  projectFormFieldsByName.set(field.name, { ...field, component: markRaw(field.component) } as unknown as ProjectFormField)
}

export function projectFormFields(): ProjectFormField[] {
  return [...projectFormFieldsByName.values()]
}

type ProjectFormValues<S extends z.ZodRawShape> = z.output<z.ZodObject<S>> & Record<string, unknown>

/** Core's schema with every contributed field's schema added under its name. */
export function projectFormSchema<S extends z.ZodRawShape>(base: z.ZodObject<S>): z.ZodType<ProjectFormValues<S>> {
  // Zod cannot type keys known only at runtime, so the contributed values are typed as unknown.
  return base.extend(Object.fromEntries(projectFormFields().map(field => [field.name, field.schema]))) as unknown as z.ZodType<ProjectFormValues<S>>
}

export function projectFormInitial(project: Workspace | null): Record<string, unknown> {
  return Object.fromEntries(projectFormFields().map(field => [field.name, field.initial(project)]))
}

export function projectFormRequest(values: Record<string, unknown>, project: Workspace | null): Partial<CreateWorkspaceRequest> {
  return Object.assign({}, ...projectFormFields().map(field => field.request?.(values[field.name], project) ?? {}))
}

export function projectFormErrorField(code: string): string | undefined {
  return projectFormFields().find(field => field.errorCodes?.includes(code))?.name
}

export function projectFormDescription(edit: boolean): string | undefined {
  const description = projectFormFields().find(field => field.description)?.description
  return edit ? description?.edit : description?.create
}

export async function projectFormAfterSave(project: Workspace, values: Record<string, unknown>, created: boolean): Promise<ProjectFormSaveNote[]> {
  const notes: ProjectFormSaveNote[] = []
  for (const field of projectFormFields()) {
    const note = await field.afterSave?.(project, { value: values[field.name], created })
    if (note) notes.push(note)
  }
  return notes
}
