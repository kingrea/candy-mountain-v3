import type { Actor, Project, RegistryResponse } from '@candy-mountain/shared'
import type { RequestContext } from '@mastra/core/request-context'
import type { CapabilityRegistry } from '../capabilities'
import type { CapabilityAccess } from '../registry'

/** Everything one turn needs, resolved for the actor and project before the model runs. */
export interface PlatformTurnContext {
  actor: Actor
  project: Project
  capabilities: CapabilityRegistry
  registry: RegistryResponse
  scopeUrlPrefix: string
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
