import { PLATFORM_AGENT_ID } from '@candy-mountain/shared'
import { defineCapability } from '../manifest'

export const platformAgentCapability = defineCapability({
  id: 'platform-agent',
  label: 'Platform agent',
  description: 'A native assistant that knows what the platform offers you and can open views or start chats on your behalf.',
  views: [],
  agents: [{ id: PLATFORM_AGENT_ID, label: 'Platform', description: 'Ask what you can do here, open a view, or start a chat with another agent.', family: 'platform', avatar: 'i-lucide-mountain' }],
  jobs: [],
  requiresPlugins: [],
  requiresPlatformFacts: ['llmGateway'],
  tools: [
    { id: 'open_view', kind: 'tool' },
    { id: 'start_chat', kind: 'tool' },
    { id: 'describe_platform', kind: 'tool' },
  ],
  ladder: [
    { name: 'none', label: 'None', description: 'The platform agent does not appear in the chat rail.', views: [], chat: false, tools: {} },
    { name: 'chat', label: 'Chat', description: 'Chat with the platform agent; what it may open or start follows your own rungs.', views: [], chat: true, tools: { open_view: {}, start_chat: {}, describe_platform: {} } },
  ],
  everyoneRung: 'chat',
})
