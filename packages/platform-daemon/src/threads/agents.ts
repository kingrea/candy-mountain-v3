import type { ContributedAgent, WorkspaceAgent, WorkspaceAgentContribution, WorkspaceAgentRegistry } from '@candy-mountain/platform-sdk/daemon'

export {
  WorkspaceAgentError,
  type ContributedAgent,
  type WorkspaceAgent,
  type WorkspaceAgentClose,
  type WorkspaceAgentContribution,
  type WorkspaceAgentListing,
  type WorkspaceAgentRegistry,
  type WorkspaceAgentSource,
  type WorkspaceAgentThreadStart,
} from '@candy-mountain/platform-sdk/daemon'

export function createWorkspaceAgentRegistry(contributions: readonly WorkspaceAgentContribution[]): WorkspaceAgentRegistry {
  const contributed = (contribution: WorkspaceAgentContribution, agent: WorkspaceAgent): ContributedAgent => ({ agent, capabilityId: contribution.capabilityId, source: contribution.source })
  return {
    list: workspaceId => contributions.flatMap(contribution => contribution.source.list(workspaceId).map(listing => ({ ...contributed(contribution, listing.agent), usable: listing.usable }))),
    find(workspaceId, agentId) {
      for (const contribution of contributions) {
        const agent = contribution.source.find(workspaceId, agentId)
        if (agent) return contributed(contribution, agent)
      }
      return null
    },
    ownerOf: session => contributions.find(contribution => contribution.source.owns(session))?.source,
  }
}
