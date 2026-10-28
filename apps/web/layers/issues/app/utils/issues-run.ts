import { CHAT_THREAD_TITLE_MAX_LENGTH, type PluginInstance, type PluginTypeInfo, type RegistryResponse } from '@candy-mountain/shared'
import { issuesAgentCreateOptions, type IssuesAgentCreateOption } from './issue-create'

export const ISSUES_RUN_PROMPT_SUFFIX = 'Check to see if you have any skills relevant to running beads.'

/** Sent verbatim; how the agent works through the issues is the codebase's business. */
export function issuesRunPrompt(ids: readonly string[]): string {
  return `Complete ${ids.join(', ')}. ${ISSUES_RUN_PROMPT_SUFFIX}`
}

export function issuesRunThreadTitle(ids: readonly string[]): string {
  const listed = `Run ${ids.join(', ')}`
  return listed.length <= CHAT_THREAD_TITLE_MAX_LENGTH ? listed : `Run ${ids.length} issues`
}

export interface IssuesRunAgent extends IssuesAgentCreateOption {
  /** The agent's own name, for the chooser and toasts. */
  name: string
}

const AGENT_NAMES: Record<string, string> = { 'claude-code': 'Claude Code', 'codex': 'Codex' }

export function issuesRunAgents(registry: RegistryResponse | null): IssuesRunAgent[] {
  return issuesAgentCreateOptions(registry).map(option => ({
    ...option,
    name: registry?.agents.find(agent => agent.id === option.agentId)?.label ?? AGENT_NAMES[option.agentId] ?? option.agentId,
  }))
}

export type IssuesRunRepository =
  | { state: 'ready' }
  | { state: 'checking' }
  | { state: 'missing', reason: string }

const REPOSITORY = 'repository'

/**
 * The Repository plugin the project resolves (its own instance, else the platform's), judged on stored health like the daemon's readiness.
 * `instances` is null when the list is not readable (non-admins), so the bots capability, which requires the plugin, is the only signal left.
 */
export function issuesRunRepository(input: {
  registry: RegistryResponse | null
  slug: string | null
  instances: readonly PluginInstance[] | null
  types: readonly PluginTypeInfo[]
  loading: boolean
}): IssuesRunRepository {
  const { registry, slug, instances, types, loading } = input
  const type = types.find(candidate => candidate.id === REPOSITORY)
  const name = type?.name ?? 'Repository'

  if (instances) {
    const instance = instances.find(candidate => candidate.type === REPOSITORY && candidate.scope === 'project' && candidate.projectSlug === slug)
      ?? instances.find(candidate => candidate.type === REPOSITORY && candidate.scope === 'global')
    if (!instance) return { state: 'missing', reason: `No ${name} plugin is configured for this project or the platform.` }
    const unset = (type?.secretFields ?? []).filter(field => field.required && instance.secrets[field.name] !== 'set').map(field => `'${field.name}'`)
    if (unset.length) return { state: 'missing', reason: `The ${name} plugin is missing the secret${unset.length > 1 ? 's' : ''} ${unset.join(', ')}.` }
    if (!instance.health) return { state: 'missing', reason: `The ${name} plugin has not been tested since it was last changed; run its connection test.` }
    if (!instance.health.healthy) return { state: 'missing', reason: `The ${name} plugin is unhealthy: ${instance.health.reason}` }
    return { state: 'ready' }
  }

  const bots = registry?.capabilities.find(capability => capability.id === 'bots')
  if (bots?.ready) return { state: 'ready' }
  const reason = bots?.reasons.find(candidate => candidate.kind === 'plugin' && candidate.plugin === REPOSITORY)
  if (reason) return { state: 'missing', reason: reason.message }
  if (loading) return { state: 'checking' }
  return { state: 'missing', reason: `Run needs a healthy ${name} plugin for this project; ask an admin to check it.` }
}

/** Why no agent can take the run: each chat capability's own readiness reasons when the actor may see them. */
export function issuesRunAgentGaps(registry: RegistryResponse | null): string[] {
  const chats = (registry?.capabilities ?? []).filter(capability => capability.id === 'chat-claude-code' || capability.id === 'chat-codex')
  const reasons = chats.flatMap((capability) => {
    if (!capability.chat) return [`Your access does not include ${capability.label}.`]
    if (capability.reasons.length) return capability.reasons.map(reason => reason.message)
    return capability.ready ? [] : [`${capability.label} is not ready for this project.`]
  })
  return ['Run needs Claude Code or Codex ready for this project.', ...reasons]
}

export interface IssuesRunAvailability {
  enabled: boolean
  agents: IssuesRunAgent[]
  /** One sentence per missing piece, for the disabled button's tooltip. */
  missing: string[]
}

export function issuesRunAvailability(registry: RegistryResponse | null, repository: IssuesRunRepository): IssuesRunAvailability {
  const agents = issuesRunAgents(registry)
  const missing: string[] = []
  if (repository.state === 'checking') missing.push('Checking the Repository plugin…')
  if (repository.state === 'missing') missing.push(repository.reason)
  if (agents.length === 0) missing.push(...issuesRunAgentGaps(registry))
  return { enabled: missing.length === 0, agents, missing }
}
