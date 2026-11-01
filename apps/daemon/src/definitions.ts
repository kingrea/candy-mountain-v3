import { botsDefinition, type BotsOptions } from './bots/definition'
import type { CapabilityRegistryEntry } from './capabilities/registry'
import { chatClaudeCodeDefinition, type ChatClaudeCodeOptions } from './chat-claude-code/definition'
import { chatCodexDefinition } from './chat-codex/definition'
import { deploymentsDefinition, type DeploymentsOptions } from './deployments/definition'
import { issuesDefinition, type IssuesOptions } from './issues/definition'
import { overviewDefinition } from './overview/definition'
import { platformAgentDefinition } from './platform-agent/definition'
import type { PlatformAgentOptions } from './platform-agent/runner'
import { teamDefinition } from './team/definition'
import { slackDefinition, type SlackOptions } from './slack/definition'
import { uptimeDefinition } from './uptime/definition'
import type { UptimeSchedulerOptions } from './uptime/scheduler'

export interface CapabilityDefinitionOptions {
  bots?: BotsOptions
  chatClaudeCode?: ChatClaudeCodeOptions
  deployments?: DeploymentsOptions
  issues?: IssuesOptions
  platformAgent?: PlatformAgentOptions
  slack?: SlackOptions
  uptime?: UptimeSchedulerOptions
}

/** What the daemon boots from; this module lives outside capabilities/ so a definition's routes can reach the capabilities index without a cycle. */
export function capabilityDefinitions({ bots, chatClaudeCode, deployments, issues, platformAgent, slack, uptime }: CapabilityDefinitionOptions = {}): readonly CapabilityRegistryEntry[] {
  return [overviewDefinition(), issuesDefinition(issues), slackDefinition(slack), botsDefinition(bots), teamDefinition(), chatClaudeCodeDefinition(chatClaudeCode), chatCodexDefinition(), uptimeDefinition(uptime), deploymentsDefinition(deployments), platformAgentDefinition(platformAgent)]
}

