import type { AgentSession } from '../index'

/** One daemon-hosted server as a launch registers it with the agent. */
export interface LaunchMcpServer {
  name: string
  /** Streamable HTTP on the loopback interface. */
  url: string
  bearerToken: string
  /** Pre-approved; for Codex also the only tools enabled. */
  tools: string[]
}

export interface AgentMcpToolResult {
  text: string
  isError?: boolean
}

export interface AgentMcpToolContext {
  session: AgentSession
  signal: AbortSignal
}

export interface AgentMcpTool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: Record<string, unknown>
  call(args: Record<string, unknown>, context: AgentMcpToolContext): Promise<AgentMcpToolResult>
}

export interface AgentMcpServerDefinition {
  name: string
  /** Asked at launch and again on every request, so a session that leaves the scope loses the server at once. */
  appliesTo(session: AgentSession): boolean
  tools: readonly AgentMcpTool[]
}

export interface AgentMcpHost {
  /** The servers one launch of the session registers; the listener starts on first use. */
  serversFor(session: AgentSession): Promise<LaunchMcpServer[]>
  close(): Promise<void>
}
