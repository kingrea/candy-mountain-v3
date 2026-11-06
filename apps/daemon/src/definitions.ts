import { botsDefinition } from '@candy-mountain/cap-bots'
import { chatClaudeCodeDefinition } from '@candy-mountain/cap-chat-claude-code'
import { chatCodexDefinition } from '@candy-mountain/cap-chat-codex'
import { deploymentsDefinition } from '@candy-mountain/cap-deployments'
import { issuesDefinition } from '@candy-mountain/cap-issues'
import { repositoryDefinition } from '@candy-mountain/cap-repository'
import { slackDefinition } from '@candy-mountain/cap-slack'
import { teamDefinition } from '@candy-mountain/cap-team'
import { uptimeDefinition } from '@candy-mountain/cap-uptime'
import { overviewDefinition, platformAgentDefinition, type CapabilityRegistryEntry } from '@candy-mountain/platform-daemon'

/** Candy Mountain's capabilities by id, in registration order. */
export const DEFINITIONS = {
  'overview': overviewDefinition,
  'repository': repositoryDefinition,
  'issues': issuesDefinition,
  'slack': slackDefinition,
  'bots': botsDefinition,
  'team': teamDefinition,
  'chat-claude-code': chatClaudeCodeDefinition,
  'chat-codex': chatCodexDefinition,
  'uptime': uptimeDefinition,
  'deployments': deploymentsDefinition,
  'platform-agent': platformAgentDefinition,
}

type DefinitionId = keyof typeof DEFINITIONS

/** Options for a definition's factory, keyed by its id; tests use them to swap in fakes. */
export type CapabilityDefinitionOptions = { [Id in DefinitionId]?: Parameters<(typeof DEFINITIONS)[Id]>[0] }

export function capabilityDefinitions(options: CapabilityDefinitionOptions = {}): readonly CapabilityRegistryEntry[] {
  return (Object.keys(DEFINITIONS) as DefinitionId[]).map(id => (DEFINITIONS[id] as (options?: unknown) => CapabilityRegistryEntry)(options[id]))
}
