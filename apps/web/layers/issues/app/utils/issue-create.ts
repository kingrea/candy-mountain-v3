import type {
  AgentSessionFamily,
  CapabilityId,
  CreateIssueRequest,
  Issue,
  IssueType,
  RegistryResponse,
} from '@candy-mountain/shared'

export interface IssuesAgentCreateOption {
  capabilityId: CapabilityId
  /** Registry agent id, which is what a chat thread is created with. */
  agentId: string
  family: AgentSessionFamily
  label: string
  icon: string
}

const ISSUES_AGENT_CREATORS: readonly IssuesAgentCreateOption[] = [
  { capabilityId: 'chat-claude-code', agentId: 'claude-code', family: 'claude-code', label: 'Create with Claude Code', icon: 'i-lucide-sparkles' },
  { capabilityId: 'chat-codex', agentId: 'codex', family: 'codex', label: 'Create with Codex', icon: 'i-lucide-square-terminal' },
]

/** The agent options to offer: only chat capabilities that are ready and that the actor may chat with. */
export function issuesAgentCreateOptions(registry: RegistryResponse | null): IssuesAgentCreateOption[] {
  if (!registry) return []
  return ISSUES_AGENT_CREATORS.filter((option) => {
    const capability = registry.capabilities.find(candidate => candidate.id === option.capabilityId)
    return capability?.ready === true && capability.chat
  })
}

export function issuesCanWrite(registry: RegistryResponse | null): boolean {
  return registry?.capabilities.some(capability => capability.id === 'issues' && capability.tools.includes('issues.write')) ?? false
}

export const ISSUES_PRIORITY_ITEMS = [
  { label: 'P0 · Critical', value: 0 },
  { label: 'P1 · High', value: 1 },
  { label: 'P2 · Medium', value: 2 },
  { label: 'P3 · Low', value: 3 },
  { label: 'P4 · Backlog', value: 4 },
]

export interface IssuesPickerItem {
  label: string
  value: string
  description: string
}

/** Closed issues are left out: nothing new should hang under or wait on finished work. */
export function issuesPickerItems(issues: readonly Issue[]): IssuesPickerItem[] {
  return issues
    .filter(issue => issue.status !== 'closed')
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map(issue => ({ label: issue.title, value: issue.id, description: issue.id }))
}

export interface IssuesCreateFormData {
  title: string
  type: IssueType
  priority: number
  labels: string[]
  parentId: string | null
  description: string
  acceptanceCriteria: string
  dependsOn: string[]
}

export function issuesCreateRequest(data: IssuesCreateFormData): CreateIssueRequest {
  const labels = [...new Set(data.labels.map(label => label.trim()).filter(Boolean))]
  const dependsOn = [...new Set(data.dependsOn)]
  const description = data.description.trim()
  const acceptanceCriteria = data.acceptanceCriteria.trim()
  return {
    title: data.title.trim(),
    type: data.type,
    priority: data.priority,
    ...(labels.length > 0 && { labels }),
    ...(data.parentId && { parentId: data.parentId }),
    ...(description && { description }),
    ...(acceptanceCriteria && { acceptanceCriteria }),
    ...(dependsOn.length > 0 && { dependsOn }),
  }
}
