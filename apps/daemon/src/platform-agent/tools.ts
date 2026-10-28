import { BOTS_CAPABILITY_ID, botIdOfAgent, PLATFORM_AGENT_CAPABILITY_ID, PLATFORM_AGENT_ID, projectViewRoute, type PlatformActionResult, type PlatformAgentToolId, type PlatformDescribeResult, type PlatformToolRefusal } from '@candy-mountain/shared'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { checkChat, checkTool, checkView, type GateRefusal } from '../registry'
import type { PlatformTurnContext } from './context'

const refusal = (result: GateRefusal): PlatformToolRefusal => ({ refused: true, code: result.code, reason: result.reason })
const refuse = (code: PlatformToolRefusal['code'], reason: string): PlatformToolRefusal => ({ refused: true, code, reason })

/** The actor's own rung on the platform agent decides whether a tool may run at all; the target's rung decides the rest. */
function ownGate(turn: PlatformTurnContext, toolId: PlatformAgentToolId): PlatformToolRefusal | null {
  const result = checkTool(turn.access(PLATFORM_AGENT_CAPABILITY_ID), toolId)
  return result.allowed ? null : refusal(result)
}

export function openView(turn: PlatformTurnContext, viewId: string): PlatformActionResult {
  const own = ownGate(turn, 'open_view')
  if (own) return own
  const owner = turn.capabilities.list().find(cap => cap.views.some(view => view.id === viewId))
  const view = owner?.views.find(candidate => candidate.id === viewId)
  if (!owner || !view) return refuse('not_found', `No view '${viewId}' exists; describe_platform lists the views that can be opened.`)
  const result = checkView(turn.access(owner.id), viewId)
  if (!result.allowed) return refusal(result)
  return {
    refused: false,
    action: { kind: 'navigate', to: projectViewRoute(turn.project.slug, view.path), projectSlug: turn.project.slug, viewId, capabilityId: owner.id },
    summary: `The browser opens ${view.label} for ${turn.project.name}.`,
  }
}

/** The registry only lists bots this actor may chat with, so absence covers unknown and unusable alike. */
function startBotChat(turn: PlatformTurnContext, ref: string): PlatformActionResult | null {
  const bots = turn.registry.agents.filter(agent => agent.kind === 'bot')
  const wanted = ref.trim().toLowerCase()
  const byId = botIdOfAgent(ref) !== null
  if (!byId && !bots.some(agent => agent.label.toLowerCase() === wanted)) return null
  const matches = bots.filter(agent => (byId ? agent.id === ref : agent.label.toLowerCase() === wanted))
  if (matches.length > 1) return refuse('invalid_request', `More than one bot is named '${ref}'; start it by agent id: ${matches.map(agent => agent.id).join(', ')}.`)
  const agent = matches[0]
  if (agent) return { refused: false, action: { kind: 'open_thread', agentId: agent.id }, summary: `The browser opens a new thread with the bot ${agent.label}.` }
  const result = checkChat(turn.access(BOTS_CAPABILITY_ID))
  if (!result.allowed) return refusal(result)
  return refuse('not_found', `No chat agent with id '${ref}'`)
}

export function startChat(turn: PlatformTurnContext, agentId: string): PlatformActionResult {
  const own = ownGate(turn, 'start_chat')
  if (own) return own
  if (agentId === PLATFORM_AGENT_ID) return refuse('invalid_request', 'This conversation already is a chat with the platform agent.')
  const bot = startBotChat(turn, agentId)
  if (bot) return bot
  const owner = turn.capabilities.list().find(cap => cap.agents.some(agent => agent.id === agentId))
  const agent = owner?.agents.find(candidate => candidate.id === agentId)
  if (!owner || !agent) return refuse('not_found', `No chat agent '${agentId}' exists; describe_platform lists the agents available.`)
  if (!agent.family) return refuse('invalid_request', `${agent.label} does not run chat threads.`)
  const result = checkChat(turn.access(owner.id))
  if (!result.allowed) return refusal(result)
  return { refused: false, action: { kind: 'open_thread', agentId }, summary: `The browser opens a new thread with ${agent.label}.` }
}

export function describePlatform(turn: PlatformTurnContext): PlatformDescribeResult {
  const own = ownGate(turn, 'describe_platform')
  if (own) return own
  const { registry, actor } = turn
  return {
    refused: false,
    project: { slug: registry.project.slug, name: registry.project.name },
    actor: { displayName: actor.displayName, admin: registry.admin },
    modules: registry.groups.filter(group => group.kind === 'module').map(group => ({ id: group.id, label: group.label })),
    views: registry.views.map(view => ({ id: view.id, label: view.label, capabilityId: view.capabilityId, to: view.to, ready: view.ready })),
    agents: registry.agents.filter(agent => agent.id !== PLATFORM_AGENT_ID).map(agent => ({ id: agent.id, label: agent.label, description: agent.description })),
    capabilities: registry.capabilities.map(cap => ({ id: cap.id, label: cap.label, rung: cap.rung, ready: cap.ready, reasons: cap.reasons.map(reason => reason.message) })),
  }
}

export function platformTools(turn: PlatformTurnContext) {
  return {
    open_view: createTool({
      id: 'open_view',
      description: 'Open one of the views listed in your instructions for the current project. Returns a navigate action the browser applies, or a refusal to relay.',
      inputSchema: z.object({ viewId: z.string().describe('The view id from the list in your instructions.') }),
      execute: async ({ viewId }) => openView(turn, viewId),
    }),
    start_chat: createTool({
      id: 'start_chat',
      description: 'Start a new chat thread with one of the chat agents listed in your instructions, including the project bots (ids like bot:<id>). Returns an open_thread action the browser applies, or a refusal to relay.',
      inputSchema: z.object({ agentId: z.string().describe('The agent id from the list in your instructions, or a bot name from that list.') }),
      execute: async ({ agentId }) => startChat(turn, agentId),
    }),
    describe_platform: createTool({
      id: 'describe_platform',
      description: 'What this person may use in the current project: enabled modules, views they can open, agents they can chat with, and their rung on each capability.',
      inputSchema: z.object({}),
      execute: async () => describePlatform(turn),
    }),
  }
}
