import {
  BOT_FAMILY_NAMES,
  BOT_SECRET_LABELS,
  BOT_SECRET_NAMES,
  type BotFamily,
  type BotPersona,
  type BotSecretName,
  type BotStatus,
  type PluginInstanceHealth,
  type PluginSecretState,
} from '@candy-mountain/shared'

export interface BotStatusInput {
  family: BotFamily
  /** The project's instance of the family's plugin type, or null when there is none. */
  familyPlugin: { health: PluginInstanceHealth | null } | null
  persona: Pick<BotPersona, 'name' | 'status' | 'reason'>
  secrets: Record<BotSecretName, PluginSecretState>
  /** Set when the base branch is blank and the repository's default branch could not be read. */
  baseBranchProblem: string | null
}

/**
 * Active needs everything; not configured means neither Slack key is set and the persona is unverified,
 * so the bot cannot run anywhere yet; anything in between lists each reason.
 */
export function computeBotStatus(input: BotStatusInput): BotStatus {
  const warnings = [
    familyWarning(input),
    personaWarning(input.persona),
    input.baseBranchProblem,
    ...BOT_SECRET_NAMES.map(name => (input.secrets[name] === 'set' ? null : `${BOT_SECRET_LABELS[name]} is missing`)),
  ].filter((w): w is string => w !== null)

  if (warnings.length === 0) return 'active'
  if (BOT_SECRET_NAMES.every(name => input.secrets[name] !== 'set') && input.persona.status !== 'verified') return 'not_configured'
  return { warnings }
}

function familyWarning({ family, familyPlugin }: BotStatusInput): string | null {
  const name = BOT_FAMILY_NAMES[family]
  if (!familyPlugin) return `The ${name} plugin is not set up for this project`
  if (!familyPlugin.health) return `The ${name} plugin has not been tested since it last changed`
  if (!familyPlugin.health.healthy) return `The ${name} plugin is unhealthy: ${familyPlugin.health.reason}`
  return null
}

function personaWarning(persona: BotStatusInput['persona']): string | null {
  if (!persona.name) return 'No persona is set'
  if (persona.status === 'unverified') return `Persona "${persona.name}" has not been checked`
  if (persona.status === 'missing') return persona.reason ?? `Persona "${persona.name}" was not found on the base branch`
  return null
}

/** Usable from the console: everything but the Slack keys, which only the Slack surface needs. */
export function botUsableWithoutSlack(input: Omit<BotStatusInput, 'secrets'>): boolean {
  const secrets = Object.fromEntries(BOT_SECRET_NAMES.map(name => [name, 'set'])) as BotStatusInput['secrets']
  return computeBotStatus({ ...input, secrets }) === 'active'
}
