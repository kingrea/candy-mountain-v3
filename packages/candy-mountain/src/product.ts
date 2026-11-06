import type { ProductConfig } from '@candy-mountain/platform-sdk'

export const CANDY_MOUNTAIN_PRODUCT: Readonly<ProductConfig> = {
  name: 'Candy Mountain',
  description: 'Codebase management platform',
  theme: { primary: 'pink', hex: '#ec4899' },
  scope: {
    label: { singular: 'project', plural: 'projects', singularTitle: 'Project', pluralTitle: 'Projects' },
    urlPrefix: 'p',
  },
  capabilities: [
    'overview',
    'repository',
    'issues',
    'slack',
    'chat-claude-code',
    'chat-codex',
    'bots',
    'team',
    'uptime',
    'deployments',
    'platform-agent',
  ],
  modules: ['issues', 'agent-hub', 'operations'],
  pluginTypes: ['repository', 'claude-code', 'codex', 'netlify', 'heroku', 'slack'],
  layers: [
    'overview',
    'issues',
    'chat',
    'chat-claude-code',
    'chat-codex',
    'bots',
    'team',
    'uptime',
    'deployments',
    'repository',
    'slack',
  ],
}
