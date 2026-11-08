import { defineCapabilityDefinition, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { ACP_CAPABILITY_ID } from '@candy-mountain/cap-acp'
import { CODEX_CAPABILITY_ID } from '@candy-mountain/plugin-codex'
import { chatCodexCapability } from './manifest'

/** The codex plugin type and family come from codex; this only shows Codex in the chat rail. */
export function chatCodexDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: chatCodexCapability.id,
    manifest: chatCodexCapability,
    dependsOn: [ACP_CAPABILITY_ID, CODEX_CAPABILITY_ID],
  })
}
