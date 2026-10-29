import { defineCapability } from '../manifest'

export const overviewCapability = defineCapability({
  id: 'overview',
  label: 'Overview',
  description: 'The project home: its facts, enabled modules, plugin health and recent activity.',
  views: [{ id: 'overview', label: 'Overview', icon: 'i-lucide-house', path: '' }],
  agents: [],
  jobs: [],
  requiresPlugins: [],
  tools: [],
  ladder: [
    { name: 'none', label: 'None', description: 'No access to the project home.', views: [], chat: false, tools: {} },
    { name: 'read', label: 'Read', description: 'See the project home.', views: ['overview'], chat: false, tools: {} },
  ],
  everyoneRung: 'read',
})
