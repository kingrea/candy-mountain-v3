import { defineCapabilityDefinition, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { ACP_SESSIONS, chatClaudeCodeCapability } from '@candy-mountain/cap-chat-claude-code'
import { codexLoginAttempts } from './plugin-type/attempts'
import { codexPluginType } from './plugin-type/definition'
import { codexLauncher } from './launcher'
import { chatCodexCapability } from './manifest'

export const CODEX_FAMILY = { id: 'codex', name: 'Codex' } as const

export function chatCodexDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: chatCodexCapability.id,
    manifest: chatCodexCapability,
    dependsOn: [chatClaudeCodeCapability.id],
    pluginTypes: [codexPluginType],
    sessionFamilies: [CODEX_FAMILY],
    start({ service }) {
      service(ACP_SESSIONS).registerLauncher(CODEX_FAMILY.id, codexLauncher)
      return {
        async close() {
          await codexLoginAttempts.close()
        },
      }
    },
  })
}
