import { defineCapability } from '@candy-mountain/platform-sdk/daemon'

export const overviewCapability = defineCapability({
  id: 'overview',
  label: 'Overview',
  description: 'The home page: its facts, enabled modules, plugin health and recent activity.',
  views: [{ id: 'overview', label: 'Overview', icon: 'i-lucide-house', path: '' }],
  agents: [],
  jobs: [],
  requiresPlugins: [],
  tools: [],
  ladder: [
    { name: 'none', label: 'None', description: 'No access to the home page.', views: [], chat: false, tools: {} },
    { name: 'read', label: 'Read', description: 'See the home page.', views: ['overview'], chat: false, tools: {} },
  ],
  everyoneRung: 'read',
})
