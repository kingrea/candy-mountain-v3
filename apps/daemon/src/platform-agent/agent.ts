import { PLATFORM_AGENT_ID } from '@candy-mountain/shared'
import { Agent } from '@mastra/core/agent'
import type { MastraStorage } from '@mastra/core/storage'
import { Memory } from '@mastra/memory'
import { turnOf } from './context'
import { platformInstructions } from './instructions'
import { platformTools } from './tools'

/** One registered agent; instructions, model and tools resolve per turn from the request context the runner sets. */
export function createPlatformAgent({ storage }: { storage: MastraStorage }) {
  const memory = new Memory({ storage, options: { lastMessages: 30, generateTitle: false, semanticRecall: false, workingMemory: { enabled: false } } })
  return new Agent({
    id: PLATFORM_AGENT_ID,
    name: 'Platform',
    description: 'Knows what the platform offers the signed-in person and can open views or start chats for them.',
    instructions: ({ requestContext }) => platformInstructions(turnOf(requestContext)),
    model: ({ requestContext }) => {
      const { model } = turnOf(requestContext)
      return { providerId: 'llm-gateway', modelId: model.modelId, url: model.baseUrl, apiKey: model.apiKey, api: 'chat' }
    },
    tools: ({ requestContext }) => platformTools(turnOf(requestContext)),
    memory,
  })
}
