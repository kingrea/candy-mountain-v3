/** A tool on a daemon-hosted MCP server; the agent sees the tool while the daemon keeps the credentials and the scope. */
export interface WrappedMcpTool {
  server: string
  tool: string
}

export const claudeMcpToolRule = ({ server, tool }: WrappedMcpTool) => `mcp__${server}__${tool}`
