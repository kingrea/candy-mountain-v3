import { defineCapability } from '../manifest'

export const deploymentsCapability = defineCapability({
  id: 'deployments',
  label: 'Deployments',
  description: 'What is live in each of the project\'s environments.',
  views: [{ id: 'deployments', label: 'Deployments', icon: 'i-lucide-rocket', path: 'deployments' }],
  agents: [],
  jobs: [],
  requiresPlugins: ['repository'],
  tools: [{ id: 'deployments.manage', kind: 'operation' }],
  ladder: [
    { name: 'none', label: 'None', description: 'No access to the project\'s deployments.', views: [], chat: false, tools: {} },
    { name: 'read', label: 'Read', description: 'See the project\'s environments and what is live in each.', views: ['deployments'], chat: false, tools: {} },
    {
      name: 'manage',
      label: 'Manage',
      description: 'Also add, edit and remove the project\'s environments.',
      views: ['deployments'],
      chat: false,
      tools: { 'deployments.manage': {} },
    },
  ],
})
