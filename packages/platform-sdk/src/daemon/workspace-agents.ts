import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { AgentSession, AgentSessionFamily, RegistryAgent } from '../index'

/** An agent a capability adds to one workspace beyond its manifest's, shaped as the registry lists it; the registry marks it a workspace agent itself. */
export interface WorkspaceAgent extends Omit<RegistryAgent, 'capabilityId' | 'family' | 'kind'> {
  family: AgentSessionFamily
}

export interface WorkspaceAgentListing {
  agent: WorkspaceAgent
  /** False keeps it out of the registry; its existing threads still list. */
  usable: boolean
}

export interface WorkspaceAgentThreadStart {
  agentId: string
  /** The thread that holds the session: created when it does not exist, switched to the new session when it does. */
  threadId: string
  actorId: string
  signal?: AbortSignal
}

export interface WorkspaceAgentClose {
  /** False when the session kept what it held; `detail` says why. */
  released: boolean
}

/** What a definition contributes for its workspace agents: the list, and the thread path their sessions take instead of the session store's. */
export interface WorkspaceAgentSource {
  /** Every agent of the workspace in listing order, usable or not. */
  list(workspaceId: string): WorkspaceAgentListing[]
  find(workspaceId: string, agentId: string): WorkspaceAgent | null
  /** True for a session one of these agents runs, whatever holds it. */
  owns(session: AgentSession): boolean
  /** Throws a WorkspaceAgentError when the session cannot start. */
  start(input: WorkspaceAgentThreadStart): Promise<void>
  /** A WorkspaceAgentError with `ended` set makes the thread start a fresh session and send the turn again. */
  prompt(sessionId: string, text: string): Promise<void>
  /** What the thread response reports for the session, in the capability's own wire shape. */
  detail(session: AgentSession): unknown
  /** Ends the turn and releases what the session holds; null when it held nothing. */
  close(sessionId: string): Promise<WorkspaceAgentClose | null>
}

/** A workspace agent's session could not start or continue; thread routes answer `status` with `code`. */
export class WorkspaceAgentError extends Error {
  readonly code: string
  readonly status: ContentfulStatusCode
  /** The session is over for good, so a thread holding it starts a fresh one in its place. */
  readonly ended: boolean

  constructor(code: string, status: ContentfulStatusCode, message: string, options: { ended?: boolean, cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'WorkspaceAgentError'
    this.code = code
    this.status = status
    this.ended = options.ended === true
  }
}

export interface WorkspaceAgentContribution {
  capabilityId: string
  source: WorkspaceAgentSource
}

export interface ContributedAgent {
  agent: WorkspaceAgent
  capabilityId: string
  source: WorkspaceAgentSource
}

/** Every definition's workspace agents behind one lookup; the registry and the thread service read it from `c.var`. */
export interface WorkspaceAgentRegistry {
  /** Contribution order, each source's listing order within it. */
  list(workspaceId: string): (ContributedAgent & Pick<WorkspaceAgentListing, 'usable'>)[]
  find(workspaceId: string, agentId: string): ContributedAgent | null
  ownerOf(session: AgentSession): WorkspaceAgentSource | undefined
}
