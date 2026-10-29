import type { ModuleDefinition } from '@candy-mountain/shared'

export const ISSUES_MODULE: ModuleDefinition = {
  id: 'issues',
  label: 'Issues',
  description: 'The project\'s issues.',
  icon: 'i-lucide-list-todo',
  capabilities: [
    { capabilityId: 'issues', defaultRung: 'write' },
  ],
}

export const AGENT_HUB_MODULE: ModuleDefinition = {
  id: 'agent-hub',
  label: 'Agent Hub',
  description: 'Chat with coding agents and run bots for the project.',
  icon: 'i-lucide-bot',
  capabilities: [
    { capabilityId: 'bots', defaultRung: 'manage' },
    { capabilityId: 'team', defaultRung: 'manage' },
    { capabilityId: 'chat-claude-code', defaultRung: 'chat' },
    { capabilityId: 'chat-codex', defaultRung: 'chat' },
  ],
}

export const OPERATIONS_MODULE: ModuleDefinition = {
  id: 'operations',
  label: 'Operations',
  description: 'Uptime and deployments for the project.',
  icon: 'i-lucide-activity',
  capabilities: [
    { capabilityId: 'uptime', defaultRung: 'manage' },
    { capabilityId: 'deployments', defaultRung: 'manage' },
  ],
}

/** Add a capability to a module by listing it in `capabilities` with its default rung. */
export const MODULES: readonly ModuleDefinition[] = [ISSUES_MODULE, AGENT_HUB_MODULE, OPERATIONS_MODULE]
