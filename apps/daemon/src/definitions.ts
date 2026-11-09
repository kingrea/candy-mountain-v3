import { acpDefinition } from '@candy-mountain/cap-acp'
import { botsDefinition } from '@candy-mountain/cap-bots'
import { chatClaudeCodeDefinition } from '@candy-mountain/cap-chat-claude-code'
import { chatCodexDefinition } from '@candy-mountain/cap-chat-codex'
import { deploymentsDefinition } from '@candy-mountain/cap-deployments'
import { issuesDefinition } from '@candy-mountain/cap-issues'
import { claudeCodeDefinition } from '@candy-mountain/plugin-claude-code'
import { codexDefinition } from '@candy-mountain/plugin-codex'
import { herokuDefinition } from '@candy-mountain/plugin-heroku'
import { netlifyDefinition } from '@candy-mountain/plugin-netlify'
import { repositoryDefinition } from '@candy-mountain/plugin-repository'
import { slackDefinition } from '@candy-mountain/plugin-slack'
import { teamDefinition } from '@candy-mountain/cap-team'
import { uptimeDefinition } from '@candy-mountain/cap-uptime'
import { overviewDefinition, platformAgentDefinition, type CapabilityRegistryEntry } from '@crab-shack/platform-daemon'

/** Candy Mountain's capabilities by id, in registration order; what a build ships. Development-only ones are in development.ts. */
export const DEFINITIONS = {
  'overview': overviewDefinition,
  'repository': repositoryDefinition,
  'issues': issuesDefinition,
  'slack': slackDefinition,
  'acp': acpDefinition,
  'bots': botsDefinition,
  'team': teamDefinition,
  'claude-code': claudeCodeDefinition,
  'chat-claude-code': chatClaudeCodeDefinition,
  'codex': codexDefinition,
  'chat-codex': chatCodexDefinition,
  'uptime': uptimeDefinition,
  'heroku': herokuDefinition,
  'netlify': netlifyDefinition,
  'deployments': deploymentsDefinition,
  'platform-agent': platformAgentDefinition,
}

type DefinitionId = keyof typeof DEFINITIONS

/** Options for a definition's factory, keyed by its id; tests use them to swap in fakes. */
export type CapabilityDefinitionOptions = { [Id in DefinitionId]?: Parameters<(typeof DEFINITIONS)[Id]>[0] }

export function capabilityDefinitions(options: CapabilityDefinitionOptions = {}): readonly CapabilityRegistryEntry[] {
  return (Object.keys(DEFINITIONS) as DefinitionId[]).map(id => (DEFINITIONS[id] as (options?: unknown) => CapabilityRegistryEntry)(options[id]))
}
