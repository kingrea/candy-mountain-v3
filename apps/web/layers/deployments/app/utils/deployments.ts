import {
  validateLiveVersionSettings,
  type CreateEnvironmentRequest,
  type Environment,
  type EnvironmentLiveVersion,
  type LiveVersion,
  type LiveVersionField,
  type LiveVersionSettingError,
  type LiveVersionSettings,
  type LiveVersionSourceField,
  type LiveVersionSourceInfo,
  type PluginInstance,
  type UpdateEnvironmentRequest,
} from '@candy-mountain/shared'

export const DEPLOYMENTS_SOURCES_DATA_KEY = 'deployments-sources'
export const deploymentsEnvironmentsDataKey = (slug: string | null) => `deployments-environments:${slug ?? ''}`
export const deploymentsLiveDataKey = (slug: string | null) => `deployments-live:${slug ?? ''}`

export const DEPLOYMENTS_MANAGE_TOOL = 'deployments.manage'

export const DEPLOYMENTS_FIELD_LABELS: Record<LiveVersionField, string> = {
  version: 'Version',
  branch: 'Branch',
  deployedAt: 'Deployed',
  link: 'Link',
}

const SOURCE_ICONS: Record<string, string> = {
  'custom-endpoint': 'i-lucide-webhook',
  'netlify': 'i-lucide-globe',
  'heroku': 'i-lucide-cloud',
}

export function deploymentsSourceIcon(kind: string): string {
  return SOURCE_ICONS[kind] ?? 'i-lucide-server'
}

export function deploymentsSourceLabel(sources: readonly LiveVersionSourceInfo[], kind: string): string {
  return sources.find(source => source.id === kind)?.label ?? kind
}

/**
 * Why a plugin-backed source cannot be picked, or null when it can. `instances` must list the project's own instances
 * before the platform-wide ones, the order in which the daemon resolves them.
 */
export function deploymentsSourcePluginReason(source: LiveVersionSourceInfo, instances: readonly PluginInstance[]): string | null {
  if (source.plugin === undefined) return null
  const instance = instances.find(candidate => candidate.type === source.plugin)
  if (!instance) return `The ${source.label} plugin is not set up for this project.`
  if (!instance.health) return `The ${source.label} plugin has not been tested since it last changed.`
  if (!instance.health.healthy) return `The ${source.label} plugin is unhealthy: ${instance.health.reason}`
  return null
}

export interface DeploymentsSourceChoices {
  available: LiveVersionSourceInfo[]
  /** Plugin-backed sources left out because their plugin is missing or unhealthy. */
  hidden: LiveVersionSourceInfo[]
}

/** The stored kind stays available so an existing environment can be edited even after its plugin breaks. */
export function deploymentsSourceChoices(
  sources: readonly LiveVersionSourceInfo[],
  instances: readonly PluginInstance[],
  currentKind?: string,
): DeploymentsSourceChoices {
  const choices: DeploymentsSourceChoices = { available: [], hidden: [] }
  for (const source of sources) {
    if (source.id === currentKind || deploymentsSourcePluginReason(source, instances) === null) choices.available.push(source)
    else choices.hidden.push(source)
  }
  return choices
}

export type DeploymentsSettingsDraft = Record<string, string>

export function deploymentsSettingsDraft(fields: readonly LiveVersionSourceField[], settings?: LiveVersionSettings): DeploymentsSettingsDraft {
  const draft: DeploymentsSettingsDraft = {}
  for (const field of fields) {
    const value = settings ? settings[field.name] : field.default
    draft[field.name] = value === undefined ? '' : String(value)
  }
  return draft
}

export function deploymentsSettingsPayload(fields: readonly LiveVersionSourceField[], draft: DeploymentsSettingsDraft): Record<string, string> {
  const payload: Record<string, string> = {}
  for (const field of fields) {
    const value = draft[field.name]?.trim()
    if (value) payload[field.name] = value
  }
  return payload
}

export function deploymentsSettingsErrors(fields: readonly LiveVersionSourceField[], draft: DeploymentsSettingsDraft): LiveVersionSettingError[] {
  const result = validateLiveVersionSettings(fields, deploymentsSettingsPayload(fields, draft))
  return result.ok ? [] : result.errors
}

export interface DeploymentsEnvironmentDraft {
  name: string
  kind: string
  settings: DeploymentsSettingsDraft
}

export function deploymentsCreateBody(fields: readonly LiveVersionSourceField[], draft: DeploymentsEnvironmentDraft): CreateEnvironmentRequest {
  return { name: draft.name.trim(), liveSourceKind: draft.kind, liveSourceSettings: deploymentsSettingsPayload(fields, draft.settings) }
}

function sameSettings(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every(key => String(a[key] ?? '') === String(b[key] ?? ''))
}

/** Only what changed, so a rename alone leaves the source untouched and the daemon does not re-check it. */
export function deploymentsUpdateBody(
  environment: Environment,
  fields: readonly LiveVersionSourceField[],
  draft: DeploymentsEnvironmentDraft,
): UpdateEnvironmentRequest {
  const body: UpdateEnvironmentRequest = {}
  const name = draft.name.trim()
  if (name !== environment.name) body.name = name
  const settings = deploymentsSettingsPayload(fields, draft.settings)
  if (draft.kind !== environment.liveSourceKind) {
    body.liveSourceKind = draft.kind
    body.liveSourceSettings = settings
  }
  else if (!sameSettings(settings, environment.liveSourceSettings)) {
    body.liveSourceSettings = settings
  }
  return body
}

export type DeploymentsLiveState =
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'error', error: string, checkedAt: string }
  | { state: 'empty', checkedAt: string }
  | { state: 'live', version: LiveVersion, checkedAt: string }

/** `failed` means the live-versions request itself failed, as opposed to one environment's source. */
export function deploymentsLiveState(entry: EnvironmentLiveVersion | undefined, failed: boolean): DeploymentsLiveState {
  if (!entry) return failed ? { state: 'unavailable' } : { state: 'loading' }
  const { live, checkedAt } = entry
  if (!live.ok) return { state: 'error', error: live.error, checkedAt }
  if (!Object.values(live.version).some(Boolean)) return { state: 'empty', checkedAt }
  return { state: 'live', version: live.version, checkedAt }
}

/** Shortens a full git SHA the way git does; any other version label is shown whole. */
export function deploymentsShortVersion(version: string): string {
  return /^[0-9a-f]{40}$/i.test(version) ? version.slice(0, 7) : version
}

export function deploymentsLinkText(link: string): string {
  try {
    const url = new URL(link)
    const path = url.pathname === '/' ? '' : url.pathname
    return `${url.host}${path}`
  }
  catch {
    return link
  }
}
