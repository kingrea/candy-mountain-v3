import {
  isValidSlug,
  WORKSPACE_COLOR_PATTERN,
  SLUG_MAX_LENGTH,
  type CreateOrganisationRequest,
  type CreateWorkspaceRequest,
  type UpdateOrganisationRequest,
  type UpdateWorkspaceRequest,
} from '@candy-mountain/shared'
import { WorkspaceError } from './errors'

const NAME_MAX_LENGTH = 200

type Body = Record<string, unknown>

function object(value: unknown): Body {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkspaceError('invalid_request', 'Request body must be a JSON object')
  }
  return value as Body
}

function optionalString(body: Body, key: string): string | undefined {
  const value = body[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new WorkspaceError('invalid_request', `${key} must be a string`)
  return value
}

function requiredString(body: Body, key: string): string {
  const value = optionalString(body, key)
  if (value === undefined) throw new WorkspaceError('invalid_request', `${key} is required`)
  return value
}

function optionalNullableString(body: Body, key: string): string | null | undefined {
  return body[key] === null ? null : optionalString(body, key)
}

export function parseCreateOrganisation(value: unknown): CreateOrganisationRequest {
  const body = object(value)
  return { name: requiredString(body, 'name'), slug: optionalString(body, 'slug') }
}

export function parseUpdateOrganisation(value: unknown): UpdateOrganisationRequest {
  const body = object(value)
  return { name: optionalString(body, 'name'), slug: optionalString(body, 'slug') }
}

export function parseCreateWorkspace(value: unknown): CreateWorkspaceRequest {
  const body = object(value)
  return {
    name: requiredString(body, 'name'),
    slug: optionalString(body, 'slug'),
    color: optionalString(body, 'color'),
    organisationId: optionalNullableString(body, 'organisationId'),
  }
}

export function parseUpdateWorkspace(value: unknown): UpdateWorkspaceRequest {
  const body = object(value)
  return {
    name: optionalString(body, 'name'),
    slug: optionalString(body, 'slug'),
    color: optionalString(body, 'color'),
    organisationId: optionalNullableString(body, 'organisationId'),
  }
}

export function checkName(raw: string): string {
  const name = raw.trim()
  if (!name) throw new WorkspaceError('invalid_request', 'name must not be empty')
  if (name.length > NAME_MAX_LENGTH) throw new WorkspaceError('invalid_request', `name must be at most ${NAME_MAX_LENGTH} characters`)
  return name
}

export function checkSlug(slug: string): string {
  if (!isValidSlug(slug)) {
    throw new WorkspaceError(
      'invalid_request',
      `slug must be lowercase letters and digits joined by single hyphens, at most ${SLUG_MAX_LENGTH} characters: "${slug}"`,
    )
  }
  return slug
}

export function checkColor(raw: string): string {
  const color = raw.trim().toLowerCase()
  if (!WORKSPACE_COLOR_PATTERN.test(color)) throw new WorkspaceError('invalid_request', `color must be a hex colour like #22c55e: "${raw}"`)
  return color
}
