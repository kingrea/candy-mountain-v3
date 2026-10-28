import { ENVIRONMENT_NAME_MAX_LENGTH, type CreateEnvironmentRequest, type UpdateEnvironmentRequest } from '@candy-mountain/shared'
import { EnvironmentError } from './errors'

const invalid = (message: string) => new EnvironmentError('invalid_request', message)

function asObject(body: unknown, what = 'Body'): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid(`${what} must be a JSON object`)
  return body as Record<string, unknown>
}

function parseName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid('name must be a non-empty string')
  const name = value.trim()
  if (name.length > ENVIRONMENT_NAME_MAX_LENGTH) throw invalid(`name must be at most ${ENVIRONMENT_NAME_MAX_LENGTH} characters`)
  return name
}

function parseKind(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid('liveSourceKind must be a non-empty string')
  return value.trim()
}

export function parseCreateEnvironment(body: unknown): CreateEnvironmentRequest {
  const raw = asObject(body)
  const request: CreateEnvironmentRequest = { name: parseName(raw.name), liveSourceKind: parseKind(raw.liveSourceKind) }
  if (raw.liveSourceSettings !== undefined && raw.liveSourceSettings !== null) request.liveSourceSettings = asObject(raw.liveSourceSettings, 'liveSourceSettings')
  return request
}

export function parseUpdateEnvironment(body: unknown): UpdateEnvironmentRequest {
  const raw = asObject(body)
  const update: UpdateEnvironmentRequest = {}
  if (raw.name !== undefined) update.name = parseName(raw.name)
  if (raw.liveSourceKind !== undefined) update.liveSourceKind = parseKind(raw.liveSourceKind)
  if (raw.liveSourceSettings !== undefined && raw.liveSourceSettings !== null) update.liveSourceSettings = asObject(raw.liveSourceSettings, 'liveSourceSettings')
  return update
}
