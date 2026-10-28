import type { AnyCapabilityManifest, PlatformFactId, PluginInstance, PluginTypeInfo, ProjectFactId, ReadinessReason } from '@candy-mountain/shared'

export type PluginReadiness = { name: string } & (
  | { state: 'ready' }
  | { state: 'missing' }
  | { state: 'secrets_missing', secrets: string[] }
  | { state: 'untested' }
  | { state: 'unhealthy', reason: string }
)

export type ProjectFacts = Record<ProjectFactId, boolean>

/** The same for every project and actor; a fact left out counts as false. */
export type PlatformFacts = Partial<Record<PlatformFactId, boolean>>

/** The instance a project resolves for a plugin type, judged on stored state only; nothing is re-tested here. */
export function assessPluginInstance(typeId: string, type: Pick<PluginTypeInfo, 'name' | 'secretFields'> | undefined, instance: Pick<PluginInstance, 'secrets' | 'health'> | null): PluginReadiness {
  const name = type?.name ?? typeId
  if (!instance) return { name, state: 'missing' }
  const secrets = (type?.secretFields ?? []).filter(field => field.required && instance.secrets[field.name] !== 'set').map(field => field.name)
  if (secrets.length) return { name, state: 'secrets_missing', secrets }
  if (!instance.health) return { name, state: 'untested' }
  if (!instance.health.healthy) return { name, state: 'unhealthy', reason: instance.health.reason }
  return { name, state: 'ready' }
}

const quoted = (values: readonly string[]) => values.map(v => `'${v}'`).join(', ')

export function pluginReason(typeId: string, readiness: PluginReadiness): ReadinessReason | null {
  const { name } = readiness
  const message = (() => {
    switch (readiness.state) {
      case 'ready': return null
      case 'missing': return `No ${name} plugin is configured for this project or the platform.`
      case 'secrets_missing': return `The ${name} plugin is missing the secret${readiness.secrets.length > 1 ? 's' : ''} ${quoted(readiness.secrets)}.`
      case 'untested': return `The ${name} plugin has not been tested since it was last changed; run its connection test.`
      case 'unhealthy': return `The ${name} plugin is unhealthy: ${readiness.reason}`
    }
  })()
  return message === null ? null : { kind: 'plugin', plugin: typeId, message }
}

const FACT_MESSAGES: Record<ProjectFactId, string> = {
  hasBeads: 'The project has no .beads directory.',
  isGitRepo: 'The project is not a git repository.',
  hasRemote: 'The project has no git remote.',
  hasBots: 'The project has no bots yet; add one on the Bots page.',
}

const PLATFORM_FACT_MESSAGES: Record<PlatformFactId, string> = {
  llmGateway: 'No LLM gateway is configured; set the gateway base URL, key and model id on the Settings page.',
}

export const requiredPluginTypes = (cap: AnyCapabilityManifest): string[] => [...cap.requiresPlugins, ...(cap.requiresAnyPlugins ?? []).flat()]

/** Empty when the capability is ready for the project. A plugin type absent from `plugins` counts as missing. */
export function capabilityReadiness(cap: AnyCapabilityManifest, plugins: Readonly<Record<string, PluginReadiness>>, facts: ProjectFacts, platformFacts: PlatformFacts = {}): ReadinessReason[] {
  const reasons: ReadinessReason[] = []
  for (const typeId of cap.requiresPlugins) {
    const reason = pluginReason(typeId, plugins[typeId] ?? { name: typeId, state: 'missing' })
    if (reason) reasons.push(reason)
  }
  for (const group of cap.requiresAnyPlugins ?? []) {
    if (group.some(typeId => plugins[typeId]?.state === 'ready')) continue
    const names = group.map(typeId => plugins[typeId]?.name ?? typeId)
    reasons.push({ kind: 'plugin-any', plugins: [...group], message: `Needs one of: ${names.join(', ')}; none is configured and healthy.` })
  }
  for (const fact of cap.requiresProjectFacts ?? []) {
    if (!facts[fact]) reasons.push({ kind: 'project-fact', fact, message: FACT_MESSAGES[fact] })
  }
  for (const fact of cap.requiresPlatformFacts ?? []) {
    if (!platformFacts[fact]) reasons.push({ kind: 'platform-fact', fact, message: PLATFORM_FACT_MESSAGES[fact] })
  }
  return reasons
}
