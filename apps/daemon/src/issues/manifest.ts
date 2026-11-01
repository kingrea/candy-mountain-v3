import { defineCapability } from '../capabilities/manifest'

export const issuesCapability = defineCapability({
  id: 'issues',
  label: 'Issues',
  description: 'The project\'s issues, read and edited through its .beads tracker.',
  // View paths cannot carry params, so the issue page (issues/:id) is a child route under this view.
  views: [{ id: 'issues', label: 'Issues', icon: 'i-lucide-list-todo', path: 'issues' }],
  agents: [],
  jobs: [],
  requiresPlugins: [],
  requiresProjectFacts: ['hasBeads'],
  tools: [
    { id: 'issues.write', kind: 'operation' },
    { id: 'issues.comment', kind: 'operation' },
  ],
  ladder: [
    { name: 'none', label: 'None', description: 'No access to the project\'s issues.', views: [], chat: false, tools: {} },
    { name: 'read', label: 'Read', description: 'See the project\'s issues and their comments.', views: ['issues'], chat: false, tools: {} },
    {
      name: 'write',
      label: 'Write',
      description: 'Also create, edit and close issues, and add and edit comments.',
      views: ['issues'],
      chat: false,
      tools: { 'issues.write': {}, 'issues.comment': {} },
    },
  ],
})
