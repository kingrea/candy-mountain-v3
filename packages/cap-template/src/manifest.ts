import { defineCapability } from '@candy-mountain/platform-sdk/daemon'
import { TEMPLATE_MANAGE_TOOL } from './wire'

export const templateCapability = defineCapability({
  id: 'template',
  label: 'Template',
  description: 'A worked example of every contribution point, to copy when starting a capability.',
  views: [{ id: 'template', label: 'Template', icon: 'i-lucide-layout-template', path: 'template' }],
  agents: [],
  jobs: [],
  requiresPlugins: [],
  tools: [{ id: TEMPLATE_MANAGE_TOOL, kind: 'operation' }],
  ladder: [
    { name: 'none', label: 'None', description: 'No access to the notes.', views: [], chat: false, tools: {} },
    { name: 'read', label: 'Read', description: 'See the notes.', views: ['template'], chat: false, tools: {} },
    { name: 'manage', label: 'Manage', description: 'Also add notes.', views: ['template'], chat: false, tools: { [TEMPLATE_MANAGE_TOOL]: {} } },
  ],
})
