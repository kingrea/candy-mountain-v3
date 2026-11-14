import { acpDefinition } from '@crab-shack/cap-acp'
import { botsDefinition } from '@crab-shack/cap-bots'
import { chatClaudeCodeDefinition } from '@crab-shack/cap-chat-claude-code'
import { chatCodexDefinition } from '@crab-shack/cap-chat-codex'
import { deploymentsDefinition } from '@crab-shack/cap-deployments'
import { issuesDefinition } from '@crab-shack/cap-issues'
import { claudeCodeDefinition } from '@crab-shack/plugin-claude-code'
import { codexDefinition } from '@crab-shack/plugin-codex'
import { herokuDefinition } from '@crab-shack/plugin-heroku'
import { netlifyDefinition } from '@crab-shack/plugin-netlify'
import { repositoryDefinition } from '@crab-shack/plugin-repository'
import { slackDefinition } from '@crab-shack/plugin-slack'
import { teamDefinition } from '@crab-shack/cap-team'
import { uptimeDefinition } from '@crab-shack/cap-uptime'
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
