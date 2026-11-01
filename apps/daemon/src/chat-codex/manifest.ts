import { defineCapability } from '../capabilities/manifest'

export const chatCodexCapability = defineCapability({
  id: 'chat-codex',
  label: 'Chat with Codex',
  description: 'Chat threads with Codex running on the project\'s checkout.',
  views: [],
  agents: [{ id: 'codex', label: 'Codex', description: 'OpenAI\'s coding agent, driven through the Codex ACP adapter.', family: 'codex', avatar: 'i-lucide-square-terminal' }],
  jobs: [],
  requiresPlugins: ['codex'],
  tools: [],
  ladder: [
    { name: 'none', label: 'None', description: 'Codex does not appear in the chat rail.', views: [], chat: false, tools: {} },
    { name: 'chat', label: 'Chat', description: 'Start and continue threads with Codex.', views: [], chat: true, tools: {} },
  ],
})
