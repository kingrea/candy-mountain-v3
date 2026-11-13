import { defineCapabilityDefinition, type CapabilityDefinition } from '@crab-shack/platform-sdk/daemon'
import { ACP_CAPABILITY_ID, ACP_SESSIONS } from '@candy-mountain/cap-acp'
import { codexLoginAttempts } from './plugin-type/attempts'
import { codexPluginType } from './plugin-type/definition'
import { codexLauncher } from './launcher'

export const CODEX_CAPABILITY_ID = 'codex'

export const CODEX_FAMILY = { id: 'codex', name: 'Codex' } as const

/** Service-only: brings the codex plugin type and family and launches Codex sessions on acp's session manager. */
export function codexDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: CODEX_CAPABILITY_ID,
    package: '@candy-mountain/plugin-codex',
    sdkMajor: 0,
    dependsOn: [ACP_CAPABILITY_ID],
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
