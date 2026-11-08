import { ACP_CAPABILITY_ID, ACP_SESSIONS } from '@candy-mountain/cap-acp'
import { defineCapabilityDefinition, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { claudeLoginAttempts } from './plugin-type/login-attempts'
import { claudeCodePluginType } from './plugin-type/definition'
import { claudeCodeLauncher } from './launcher'

export const CLAUDE_CODE_CAPABILITY_ID = 'claude-code'

export const CLAUDE_CODE_FAMILY = { id: 'claude-code', name: 'Claude Code' } as const

/** Service-only: brings the claude-code plugin type and family and launches Claude Code sessions on acp's session manager. */
export function claudeCodeDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: CLAUDE_CODE_CAPABILITY_ID,
    dependsOn: [ACP_CAPABILITY_ID],
    pluginTypes: [claudeCodePluginType],
    sessionFamilies: [CLAUDE_CODE_FAMILY],
    start({ service }) {
      service(ACP_SESSIONS).registerLauncher(CLAUDE_CODE_FAMILY.id, claudeCodeLauncher)
      return {
        close() {
          claudeLoginAttempts.close()
        },
      }
    },
  })
}
