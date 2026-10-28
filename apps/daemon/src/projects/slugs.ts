import { SLUG_MAX_LENGTH, slugify } from '@candy-mountain/shared'
import { ProjectError } from './errors'
import { checkSlug } from './validation'

export function resolveSlug(explicit: string | undefined, name: string, taken: (slug: string) => boolean, entity: string): string {
  if (explicit !== undefined) {
    const slug = checkSlug(explicit)
    if (taken(slug)) throw new ProjectError('slug_taken', `${entity} slug "${slug}" is already in use`)
    return slug
  }

  const base = slugify(name)
  if (!base) throw new ProjectError('invalid_request', `name "${name}" has no URL-safe characters; provide a slug`)
  if (!taken(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!taken(candidate)) return candidate
  }
}

// Drizzle wraps driver errors, so the SQLite code may sit on the cause.
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ((current as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE') return true
  }
  return false
}
