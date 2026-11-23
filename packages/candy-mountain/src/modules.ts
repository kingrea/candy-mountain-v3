import type { ModuleDefinition } from '@crab-shack/platform-sdk'

export const ISSUES_MODULE: ModuleDefinition = {
  id: 'issues',
  label: 'Issues',
  description: 'The project\'s issues.',
  icon: 'i-lucide-list-todo',
  plugins: [
    { pluginId: 'issues', defaultAccessLevel: 'write' },
  ],
}

export const AGENT_HUB_MODULE: ModuleDefinition = {
  id: 'agent-hub',
  label: 'Agent Hub',
  description: 'Chat with coding agents and run bots for the project.',
  icon: 'i-lucide-bot',
  plugins: [
    { pluginId: 'agents', defaultAccessLevel: 'manage' },
    { pluginId: 'bots', defaultAccessLevel: 'manage' },
    { pluginId: 'team', defaultAccessLevel: 'manage' },
    { pluginId: 'chat-claude-code', defaultAccessLevel: 'chat' },
    { pluginId: 'chat-codex', defaultAccessLevel: 'chat' },
  ],
}

export const OPERATIONS_MODULE: ModuleDefinition = {
  id: 'operations',
  label: 'Operations',
  description: 'Uptime and deployments for the project.',
  icon: 'i-lucide-activity',
  plugins: [
    { pluginId: 'uptime', defaultAccessLevel: 'manage' },
    { pluginId: 'deployments', defaultAccessLevel: 'manage' },
  ],
}

/** Add a plugin to a module by listing it in `plugins` with its default access level. */
export const MODULES: readonly ModuleDefinition[] = [ISSUES_MODULE, AGENT_HUB_MODULE, OPERATIONS_MODULE]
