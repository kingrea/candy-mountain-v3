import {
  isValidSlug,
  PROJECT_COLOR_PATTERN,
  PROJECT_SOURCE_KINDS,
  SLUG_MAX_LENGTH,
  type CreateOrganisationRequest,
  type CreateProjectRequest,
  type ProjectSource,
  type UpdateOrganisationRequest,
  type UpdateProjectRequest,
  type VerifyPathRequest,
} from '@candy-mountain/shared'
import { ProjectError } from './errors'

const NAME_MAX_LENGTH = 200

type Body = Record<string, unknown>

function object(value: unknown): Body {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectError('invalid_request', 'Request body must be a JSON object')
  }
  return value as Body
}

function optionalString(body: Body, key: string): string | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new ProjectError('invalid_request', `${key} must be a string`)
  return value
}

function requiredString(body: Body, key: string): string {
  const value = optionalString(body, key)
  if (value === undefined) throw new ProjectError('invalid_request', `${key} is required`)
  return value
}

function optionalNullableString(body: Body, key: string): string | null | undefined {
  return body[key] === null ? null : optionalString(body, key)
}

function source(value: unknown): ProjectSource {
  const body = object(value)
  if (!PROJECT_SOURCE_KINDS.includes(body.kind as never)) {
    throw new ProjectError('invalid_request', `source.kind must be one of: ${PROJECT_SOURCE_KINDS.join(', ')}`)
  }
  return { kind: 'local-path', path: requiredString(body, 'path') }
}

export function parseCreateOrganisation(value: unknown): CreateOrganisationRequest {
  const body = object(value)
  return { name: requiredString(body, 'name'), slug: optionalString(body, 'slug') }
}

export function parseUpdateOrganisation(value: unknown): UpdateOrganisationRequest {
  const body = object(value)
  return { name: optionalString(body, 'name'), slug: optionalString(body, 'slug') }
}

export function parseCreateProject(value: unknown): CreateProjectRequest {
  const body = object(value)
  if (body.source === undefined) throw new ProjectError('invalid_request', 'source is required')
  return {
    name: requiredString(body, 'name'),
    slug: optionalString(body, 'slug'),
    color: optionalString(body, 'color'),
    organisationId: optionalNullableString(body, 'organisationId'),
    source: source(body.source),
  }
}

export function parseUpdateProject(value: unknown): UpdateProjectRequest {
  const body = object(value)
  return {
    name: optionalString(body, 'name'),
    slug: optionalString(body, 'slug'),
    color: optionalString(body, 'color'),
    organisationId: optionalNullableString(body, 'organisationId'),
    source: body.source === undefined ? undefined : source(body.source),
  }
}

export function parseVerifyPath(value: unknown): VerifyPathRequest {
  return { path: requiredString(object(value), 'path') }
}

export function checkName(raw: string): string {
  const name = raw.trim()
  if (!name) throw new ProjectError('invalid_request', 'name must not be empty')
  if (name.length > NAME_MAX_LENGTH) throw new ProjectError('invalid_request', `name must be at most ${NAME_MAX_LENGTH} characters`)
  return name
}

export function checkSlug(slug: string): string {
  if (!isValidSlug(slug)) {
    throw new ProjectError(
      'invalid_request',
      `slug must be lowercase letters and digits joined by single hyphens, at most ${SLUG_MAX_LENGTH} characters: "${slug}"`,
    )
  }
  return slug
}

export function checkColor(raw: string): string {
  const color = raw.trim().toLowerCase()
  if (!PROJECT_COLOR_PATTERN.test(color)) throw new ProjectError('invalid_request', `color must be a hex colour like #22c55e: "${raw}"`)
  return color
}
