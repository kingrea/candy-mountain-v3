import { claudeCodeDefinition } from '@crab-shack/connection-claude-code'
import { codexDefinition } from '@crab-shack/connection-codex'
import { herokuDefinition } from '@crab-shack/connection-heroku'
import { netlifyDefinition } from '@crab-shack/connection-netlify'
import { repositoryDefinition } from '@crab-shack/connection-repository'
import { slackDefinition } from '@crab-shack/connection-slack'
import { overviewDefinition, platformAgentDefinition, type CapabilityRegistryEntry } from '@crab-shack/platform-daemon'
import { acpDefinition } from '@crab-shack/plugin-acp'
import { agentsDefinition } from '@crab-shack/plugin-agents'
import { botsDefinition } from '@crab-shack/plugin-bots'
import { chatClaudeCodeDefinition } from '@crab-shack/plugin-chat-claude-code'
import { chatCodexDefinition } from '@crab-shack/plugin-chat-codex'
import { deploymentsDefinition } from '@crab-shack/plugin-deployments'
import { issuesDefinition } from '@crab-shack/plugin-issues'
import { teamDefinition } from '@crab-shack/plugin-team'
import { uptimeDefinition } from '@crab-shack/plugin-uptime'
import { worktreesDefinition } from '@crab-shack/plugin-worktrees'

/** Candy Mountain's capabilities by id, in registration order; what a build ships. */
export const DEFINITIONS = {
  'overview': overviewDefinition,
  'repository': repositoryDefinition,
  'issues': issuesDefinition,
  'slack': slackDefinition,
  'acp': acpDefinition,
  'worktrees': worktreesDefinition,
  'claude-code': claudeCodeDefinition,
  'chat-claude-code': chatClaudeCodeDefinition,
  'codex': codexDefinition,
  'chat-codex': chatCodexDefinition,
  'agents': agentsDefinition,
  'team': teamDefinition,
  'bots': botsDefinition,
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
