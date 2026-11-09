import { SLACK_POST_BLOCKS_TOOL } from '@candy-mountain/plugin-slack'
import { claudeMcpToolRule, type WrappedMcpTool } from '@crab-shack/platform-daemon'

export const WRAPPED_MCP_TOOLS: readonly WrappedMcpTool[] = [SLACK_POST_BLOCKS_TOOL]

/** The only MCP allow rules a bot posture may carry. */
export const WRAPPED_MCP_TOOL_RULES: readonly string[] = WRAPPED_MCP_TOOLS.map(claudeMcpToolRule)
