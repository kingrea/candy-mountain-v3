import { defineCapabilityDefinition, type CapabilityDefinition } from '../capabilities/definition'
import { ACP_SESSIONS } from '../chat-claude-code/definition'
import { chatClaudeCodeCapability } from '../chat-claude-code/manifest'
import { codexLoginAttempts } from '../plugins/codex/attempts'
import { codexPluginType } from '../plugins/types/codex'
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
