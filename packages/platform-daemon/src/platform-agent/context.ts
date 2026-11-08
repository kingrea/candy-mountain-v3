import type { Actor, Workspace, RegistryResponse, ScopeLabel } from '@candy-mountain/platform-sdk'
import type { RequestContext } from '@mastra/core/request-context'
import type { CapabilityRegistry } from '../capabilities'
import type { CapabilityAccess } from '../registry'

/** Everything one turn needs, resolved for the actor and workspace before the model runs. */
export interface PlatformTurnContext {
  actor: Actor
  workspace: Workspace
  capabilities: CapabilityRegistry
  registry: RegistryResponse
  scopeUrlPrefix: string
  scopeLabel: ScopeLabel
  access(capabilityId: string): CapabilityAccess
  model: { baseUrl: string, modelId: string, apiKey: string }
}

export const PLATFORM_TURN_KEY = 'platformTurn'
export type PlatformRequestContext = { [PLATFORM_TURN_KEY]: PlatformTurnContext }

export function turnOf(requestContext: RequestContext<PlatformRequestContext> | RequestContext<unknown> | undefined): PlatformTurnContext {
  const turn = (requestContext as RequestContext<PlatformRequestContext> | undefined)?.get(PLATFORM_TURN_KEY)
  if (!turn) throw new Error('The platform agent can only run inside a chat thread turn')
  return turn
}
