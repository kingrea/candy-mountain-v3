import {
  BOT_FAMILIES,
  BOT_FAMILY_NAMES,
  BOT_PERSONA_FILE_KEYS,
  BOT_SECRET_NAMES,
  botPersonaMissingReason,
  botPersonaPath,
  type Bot,
  type BotFamily,
  type BotPersonaFiles,
  type BotSlackConnection,
  type BotStatus,
  type PluginInstance,
} from '@candy-mountain/shared'

export const BOTS_DATA_KEY_PREFIX = 'bots:'
export const BOTS_PLUGINS_DATA_KEY_PREFIX = 'bots-plugins:'

export const botsDataKey = (slug: string | null) => `${BOTS_DATA_KEY_PREFIX}${slug ?? ''}`
export const botsPluginsDataKey = (slug: string | null) => `${BOTS_PLUGINS_DATA_KEY_PREFIX}${slug ?? ''}`

/** Same wording as the daemon's status warning, so the form and the card agree. */
export function botsFamilyPluginReason(instances: readonly PluginInstance[], family: BotFamily): string | null {
  // The daemon lists the project's own instances before global ones, which is the order it resolves them in.
  const instance = instances.find(candidate => candidate.type === family)
  const name = BOT_FAMILY_NAMES[family]
  if (!instance) return `The ${name} plugin is not set up for this project`
  if (!instance.health) return `The ${name} plugin has not been tested since it last changed`
  if (!instance.health.healthy) return `The ${name} plugin is unhealthy: ${instance.health.reason}`
  return null
}

export interface BotsPersonaCheck {
  personaName: string
  files: BotPersonaFiles
}

export interface BotsFamilyOption {
  value: BotFamily
  label: string
  disabled: boolean
  description?: string
}

export interface BotsFamilyOptionsInput {
  pluginReasons: Record<BotFamily, string | null>
  personaCheck: BotsPersonaCheck | null
  /** The saved bot's family: the daemon lets a bot keep it while its plugin is unhealthy. */
  currentFamily?: BotFamily
}

export function botsPersonaMissing(check: BotsPersonaCheck | null, family: BotFamily): string | null {
  if (!check || check.files[BOT_PERSONA_FILE_KEYS[family]]) return null
  return botPersonaMissingReason(family, check.personaName, check.files.branch)
}

export function botsFamilyOptions({ pluginReasons, personaCheck, currentFamily }: BotsFamilyOptionsInput): BotsFamilyOption[] {
  return BOT_FAMILIES.map((family) => {
    const pluginReason = pluginReasons[family]
    const personaReason = botsPersonaMissing(personaCheck, family)
    const kept = family === currentFamily && personaReason === null
    const reason = personaReason ?? pluginReason
    return {
      value: family,
      label: BOT_FAMILY_NAMES[family],
      disabled: reason !== null && !kept,
      ...(reason ? { description: reason } : {}),
    }
  })
}

export interface BotsPersonaFileRow {
  family: BotFamily
  path: string
  found: boolean
}

export function botsPersonaFileRows(check: BotsPersonaCheck): BotsPersonaFileRow[] {
  return BOT_FAMILIES.map(family => ({
    family,
    path: botPersonaPath(family, check.personaName),
    found: check.files[BOT_PERSONA_FILE_KEYS[family]],
  }))
}

export interface BotsStatusView {
  label: string
  color: 'success' | 'neutral' | 'warning'
  icon: string
  warnings: string[]
}

export function botsStatusView(status: BotStatus): BotsStatusView {
  if (status === 'active') return { label: 'Active', color: 'success', icon: 'i-lucide-circle-check', warnings: [] }
  if (status === 'not_configured') return { label: 'Not configured', color: 'neutral', icon: 'i-lucide-circle-dashed', warnings: [] }
  const count = status.warnings.length
  return { label: count === 1 ? '1 warning' : `${count} warnings`, color: 'warning', icon: 'i-lucide-triangle-alert', warnings: status.warnings }
}

/** The repository default as far as the page knows it: a bot that follows the default has it resolved. */
export function botsRepositoryDefaultBranch(bots: readonly Bot[], instances: readonly PluginInstance[]): string | null {
  const configured = instances.find(instance => instance.type === 'repository')?.config.defaultBranch
  if (typeof configured === 'string' && configured) return configured
  return bots.find(bot => bot.baseBranch === null && bot.effectiveBaseBranch)?.effectiveBaseBranch ?? null
}

export interface BotsSlackView {
  label: string
  color: 'success' | 'warning' | 'error' | 'neutral'
  icon: string
  detail: string | null
}

export function botsSlackView(bot: Bot, connection: BotSlackConnection | null): BotsSlackView | null {
  const keysMissing = BOT_SECRET_NAMES.some(name => bot.secrets[name] !== 'set')
  if (keysMissing || connection?.reasonCode === 'missing_keys') {
    return { label: 'Not configured', color: 'neutral', icon: 'i-lucide-circle-dashed', detail: 'Slack keys are missing' }
  }
  if (!connection) return null
  if (connection.state === 'connected') {
    const { identity } = connection
    return { label: 'Connected', color: 'success', icon: 'i-lucide-plug-zap', detail: identity ? `${identity.user} in ${identity.team}` : null }
  }
  if (connection.state === 'connecting') {
    return { label: 'Connecting', color: 'warning', icon: 'i-lucide-loader-circle', detail: null }
  }
  return { label: 'Disconnected', color: 'error', icon: 'i-lucide-unplug', detail: connection.reason }
}
