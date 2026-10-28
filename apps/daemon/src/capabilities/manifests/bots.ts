import { defineCapability } from '../manifest'

export const botsCapability = defineCapability({
  id: 'bots',
  label: 'Bots',
  description: 'Slack bots that run a coding agent against the project.',
  views: [{ id: 'bots', label: 'Bots', icon: 'i-lucide-bot', path: 'bots' }],
  agents: [],
  projectAgents: true,
  jobs: [],
  requiresPlugins: ['repository'],
  requiresAnyPlugins: [['claude-code', 'codex']],
  tools: [],
  ladder: [
    { name: 'none', label: 'None', description: 'No access to the project\'s bots.', views: [], chat: false, tools: {} },
    // Chat here means running the bots from the chat rail, which also needs chat on the bot's family capability.
    { name: 'manage', label: 'Manage', description: 'See, add, edit and remove the project\'s bots, and run them from the chat rail.', views: ['bots'], chat: true, tools: {} },
  ],
})
