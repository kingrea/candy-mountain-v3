import { validateMonitorOptions, type MonitorOptionError, type MonitorOptionField, type MonitorOptions } from './uptime'

export const LIVE_VERSION_SOURCES_PATH = '/live-version-sources'
export const projectEnvironmentsPath = (slug: string) => `/projects/${slug}/environments`
export const projectEnvironmentPath = (slug: string, id: string) => `${projectEnvironmentsPath(slug)}/${id}`
export const projectLiveVersionsPath = (slug: string) => `/projects/${slug}/live-versions`

export const ENVIRONMENT_NAME_MAX_LENGTH = 100
export const LIVE_VERSION_SOURCE_ID_PATTERN = /^[a-z][a-z0-9-]*$/

/** What is live in an environment, whichever vendor serves it; every field is optional because sources know different things. */
export interface LiveVersion {
  /** A version label or a commit SHA. */
  version?: string
  branch?: string
  /** ISO 8601. */
  deployedAt?: string
  /** An absolute http(s) URL for the live deploy or site. */
  link?: string
}

export const LIVE_VERSION_FIELDS = ['version', 'branch', 'deployedAt', 'link'] as const satisfies readonly (keyof LiveVersion)[]
export type LiveVersionField = (typeof LIVE_VERSION_FIELDS)[number]

export type LiveVersionResult = { ok: true, version: LiveVersion } | { ok: false, error: string }

/** Settings fields share the monitor option field kinds and validation rules. */
export type LiveVersionSourceField = MonitorOptionField
export type LiveVersionSettings = MonitorOptions
export type LiveVersionSettingError = MonitorOptionError
export type LiveVersionSettingsResult = { ok: true, settings: LiveVersionSettings } | { ok: false, errors: LiveVersionSettingError[] }

export function validateLiveVersionSettings(fields: readonly LiveVersionSourceField[], input: unknown): LiveVersionSettingsResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ field: '', message: 'Settings must be an object.' }] }
  }
  const result = validateMonitorOptions(fields, input)
  return result.ok ? { ok: true, settings: result.options } : result
}

export interface LiveVersionSourceInfo {
  id: string
  label: string
  description: string
  fields: readonly LiveVersionSourceField[]
}

export function liveVersionSourceInfo(source: LiveVersionSourceInfo): LiveVersionSourceInfo {
  const { id, label, description, fields } = source
  return { id, label, description, fields }
}

export interface Environment {
  id: string
  projectId: string
  name: string
  /** A registered live-version source id, such as 'custom-endpoint'. */
  liveSourceKind: string
  liveSourceSettings: LiveVersionSettings
  /** Reserved for deploy strategies; always null for now. */
  deployKind: string | null
  deploySettings: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export interface CreateEnvironmentRequest {
  name: string
  liveSourceKind: string
  liveSourceSettings?: Record<string, unknown>
}

/** Omitted fields are unchanged; `liveSourceSettings`, when sent, replaces the stored settings whole. */
export type UpdateEnvironmentRequest = Partial<CreateEnvironmentRequest>

export interface EnvironmentListResponse {
  environments: Environment[]
}

export interface EnvironmentResponse {
  environment: Environment
}

export interface LiveVersionSourceListResponse {
  sources: LiveVersionSourceInfo[]
}

export interface EnvironmentLiveVersion {
  environmentId: string
  environmentName: string
  liveSourceKind: string
  /** ISO 8601 time the source was read. */
  checkedAt: string
  live: LiveVersionResult
}

/** One entry per environment, in environment order; a failing source fails only its own entry. */
export interface LiveVersionsResponse {
  environments: EnvironmentLiveVersion[]
}

export const ENVIRONMENT_ERROR_CODES = ['invalid_request', 'not_found', 'name_taken', 'unknown_source', 'invalid_settings'] as const
export type EnvironmentErrorCode = (typeof ENVIRONMENT_ERROR_CODES)[number]
