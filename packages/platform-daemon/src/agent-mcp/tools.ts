/** A tool on a daemon-hosted MCP server; the agent sees the tool while the daemon keeps the credentials and the scope. */
export interface WrappedMcpTool {
  server: string
  tool: string
}

export const SLACK_POST_BLOCKS_TOOL = { server: 'candy_mountain_slack', tool: 'post_blocks' } as const satisfies WrappedMcpTool

export const WRAPPED_MCP_TOOLS: readonly WrappedMcpTool[] = [SLACK_POST_BLOCKS_TOOL]

export const claudeMcpToolRule = ({ server, tool }: WrappedMcpTool) => `mcp__${server}__${tool}`

/** The only MCP allow rules a bot posture may carry. */
export const WRAPPED_MCP_TOOL_RULES: readonly string[] = WRAPPED_MCP_TOOLS.map(claudeMcpToolRule)
