import { REPOSITORY_SOURCE_KINDS, type CheckRepositoryPathRequest, type RepositorySource, type SetRepositoryRequest } from '@candy-mountain/platform-sdk'
import { RepositoryError } from './errors'

type Body = Record<string, unknown>

function object(value: unknown): Body {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RepositoryError('invalid_request', 'Request body must be a JSON object')
  }
  return value as Body
}

function requiredString(body: Body, key: string): string {
  const value = body[key]
  if (value === undefined) throw new RepositoryError('invalid_request', `${key} is required`)
  if (typeof value !== 'string') throw new RepositoryError('invalid_request', `${key} must be a string`)
  return value
}

function source(value: unknown): RepositorySource {
  const body = object(value)
  if (!REPOSITORY_SOURCE_KINDS.includes(body.kind as never)) {
    throw new RepositoryError('invalid_request', `source.kind must be one of: ${REPOSITORY_SOURCE_KINDS.join(', ')}`)
  }
  return { kind: 'local-path', path: requiredString(body, 'path') }
}

export function parseSetRepository(value: unknown): SetRepositoryRequest {
  const body = object(value)
  if (body.source === undefined) throw new RepositoryError('invalid_request', 'source is required')
  return { source: source(body.source) }
}

export function parseCheckRepositoryPath(value: unknown): CheckRepositoryPathRequest {
  return { path: requiredString(object(value), 'path') }
}
