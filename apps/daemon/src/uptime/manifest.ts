import { defineCapability } from '../capabilities/manifest'

export const uptimeCapability = defineCapability({
  id: 'uptime',
  label: 'Uptime',
  description: 'Whether the project\'s sites and vendors are up, from monitors checked on a schedule.',
  views: [{ id: 'uptime', label: 'Uptime', icon: 'i-lucide-heart-pulse', path: 'uptime' }],
  agents: [],
  jobs: [],
  requiresPlugins: [],
  tools: [{ id: 'uptime.manage', kind: 'operation' }],
  ladder: [
    { name: 'none', label: 'None', description: 'No access to the project\'s monitors.', views: [], chat: false, tools: {} },
    { name: 'read', label: 'Read', description: 'See the project\'s monitors, their state and recent checks.', views: ['uptime'], chat: false, tools: {} },
    {
      name: 'manage',
      label: 'Manage',
      description: 'Also add, edit, enable, disable and remove the project\'s monitors.',
      views: ['uptime'],
      chat: false,
      tools: { 'uptime.manage': {} },
    },
  ],
})
