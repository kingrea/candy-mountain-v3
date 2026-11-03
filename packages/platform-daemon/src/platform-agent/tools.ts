import { PLATFORM_AGENT_CAPABILITY_ID, PLATFORM_AGENT_ID, workspaceViewRoute, type PlatformActionResult, type PlatformAgentToolId, type PlatformDescribeResult, type PlatformToolRefusal, type RegistryAgent } from '@candy-mountain/platform-sdk'
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
    action: { kind: 'navigate', to: workspaceViewRoute(turn.scopeUrlPrefix, turn.workspace.slug, view.path), workspaceSlug: turn.workspace.slug, viewId, capabilityId: owner.id },
    summary: `The browser opens ${view.label} for ${turn.workspace.name}.`,
  }
}

const opened = (agent: Pick<RegistryAgent, 'id' | 'label'>): PlatformActionResult => ({ refused: false, action: { kind: 'open_thread', agentId: agent.id }, summary: `The browser opens a new thread with ${agent.label}.` })

/** Workspace agents go by id or name; the registry only lists the ones this actor may chat with, so absence covers unknown and unusable alike. */
function startWorkspaceAgentChat(turn: PlatformTurnContext, ref: string): PlatformActionResult | null {
  const agents = turn.registry.agents.filter(agent => agent.kind === 'workspace')
  const wanted = ref.trim().toLowerCase()
  const byId = agents.filter(agent => agent.id === ref)
  const matches = byId.length ? byId : agents.filter(agent => agent.label.toLowerCase() === wanted)
  if (matches.length > 1) return refuse('invalid_request', `More than one agent is named '${ref}'; start it by agent id: ${matches.map(agent => agent.id).join(', ')}.`)
  const agent = matches[0]
  return agent ? opened(agent) : null
}

/** An unknown agent may belong to a capability whose workspace agents the actor cannot chat with at all; the reason says so. */
function unknownAgent(turn: PlatformTurnContext, agentId: string): PlatformToolRefusal {
  const unusable = turn.capabilities.list().filter(cap => cap.workspaceAgents).map(cap => checkChat(turn.access(cap.id))).flatMap(result => (result.allowed ? [] : [result.reason]))
  return refuse('not_found', [`No chat agent '${agentId}' exists; describe_platform lists the agents available.`, ...unusable].join(' '))
}

export function startChat(turn: PlatformTurnContext, agentId: string): PlatformActionResult {
  const own = ownGate(turn, 'start_chat')
  if (own) return own
  if (agentId === PLATFORM_AGENT_ID) return refuse('invalid_request', 'This conversation already is a chat with the platform agent.')
  const workspaceAgent = startWorkspaceAgentChat(turn, agentId)
  if (workspaceAgent) return workspaceAgent
  const owner = turn.capabilities.list().find(cap => cap.agents.some(agent => agent.id === agentId))
  const agent = owner?.agents.find(candidate => candidate.id === agentId)
  if (!owner || !agent) return unknownAgent(turn, agentId)
  if (!agent.family) return refuse('invalid_request', `${agent.label} does not run chat threads.`)
  const result = checkChat(turn.access(owner.id))
  if (!result.allowed) return refusal(result)
  return opened(agent)
}

export function describePlatform(turn: PlatformTurnContext): PlatformDescribeResult {
  const own = ownGate(turn, 'describe_platform')
  if (own) return own
  const { registry, actor } = turn
  return {
    refused: false,
    workspace: { slug: registry.workspace.slug, name: registry.workspace.name },
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
      description: 'Start a new chat thread with one of the chat agents listed in your instructions, including the agents the project itself adds. Returns an open_thread action the browser applies, or a refusal to relay.',
      inputSchema: z.object({ agentId: z.string().describe('The agent id from the list in your instructions, or the name of an agent the project adds.') }),
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
