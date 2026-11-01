import { defineCapability } from '../capabilities/manifest'

export const chatClaudeCodeCapability = defineCapability({
  id: 'chat-claude-code',
  label: 'Chat with Claude Code',
  description: 'Chat threads with Claude Code running on the project\'s checkout.',
  views: [],
  agents: [{ id: 'claude-code', label: 'Claude Code', description: 'Anthropic\'s coding agent, driven through the Claude Code CLI.', family: 'claude-code', avatar: 'i-lucide-sparkles' }],
  jobs: [],
  requiresPlugins: ['claude-code'],
  tools: [],
  ladder: [
    { name: 'none', label: 'None', description: 'Claude Code does not appear in the chat rail.', views: [], chat: false, tools: {} },
    { name: 'chat', label: 'Chat', description: 'Start and continue threads with Claude Code.', views: [], chat: true, tools: {} },
  ],
})
