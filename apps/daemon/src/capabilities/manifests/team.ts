import { defineCapability } from '../manifest'

export const teamCapability = defineCapability({
  id: 'team',
  label: 'Team',
  description: 'The people allowed to talk to the project\'s bots.',
  views: [{ id: 'team', label: 'Team', icon: 'i-lucide-users', path: 'team' }],
  agents: [],
  jobs: [],
  requiresPlugins: [],
  requiresProjectFacts: ['hasBots'],
  tools: [],
  ladder: [
    { name: 'none', label: 'None', description: 'No access to the project\'s team.', views: [], chat: false, tools: {} },
    { name: 'manage', label: 'Manage', description: 'See, add, edit and remove the people on the project\'s team.', views: ['team'], chat: false, tools: {} },
  ],
})
