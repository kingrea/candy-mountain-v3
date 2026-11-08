import { ACP_CAPABILITY_ID } from '@candy-mountain/cap-acp'
import { CLAUDE_CODE_CAPABILITY_ID } from '@candy-mountain/plugin-claude-code'
import { REPOSITORY_CAPABILITY_ID } from '@candy-mountain/plugin-repository'
import { defineCapabilityDefinition, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { chatClaudeCodeCapability } from './manifest'

/** The claude-code plugin type and family come from claude-code; this only shows Claude Code in the chat rail. */
export function chatClaudeCodeDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: chatClaudeCodeCapability.id,
    manifest: chatClaudeCodeCapability,
    dependsOn: [ACP_CAPABILITY_ID, CLAUDE_CODE_CAPABILITY_ID, REPOSITORY_CAPABILITY_ID],
  })
}
