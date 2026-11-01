/** What a product calls its workspace, in every form the UI prints. */
export interface ScopeLabel {
  singular: string
  plural: string
  singularTitle: string
  pluralTitle: string
}

export interface ProductTheme {
  /** Nuxt UI colour name used as `primary`. */
  primary: string
  /** The same colour as `#rrggbb`, for the theme-color meta and the PWA manifest. */
  hex: string
}

// Ids stay plain strings: the daemon and the web shell validate them against
// what they actually register, so adding a capability never edits this package.
// `capabilities` names every daemon definition, service-only ones (slack) included.
export interface ProductConfig {
  name: string
  /** One line for the PWA manifest. */
  description: string
  theme: ProductTheme
  scope: {
    label: ScopeLabel
    /** Single path segment in front of the workspace slug, as in `/p/<slug>`. */
    urlPrefix: string
  }
  capabilities: readonly string[]
  modules: readonly string[]
  pluginTypes: readonly string[]
  layers: readonly string[]
}

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
