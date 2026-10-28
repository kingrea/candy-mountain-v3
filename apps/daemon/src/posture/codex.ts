import type { BotWriteScope } from '@candy-mountain/shared'
import type { CodexAgentMode, CodexLaunchOptions } from '../acp/families'

/** Codex has no confirm-each-edit mode: the workspace-write sandbox never asks inside the worktree. */
export const CODEX_MODES = {
  'read-only': 'read-only',
  'write-confirm': 'workspace-write',
  'write-auto': 'workspace-write',
} as const satisfies Record<BotWriteScope, CodexAgentMode>

export interface CodexPostureInput {
  writeScope: BotWriteScope
  personaText: string
  surfaceInstructions?: string
  beadsDir?: string
}

export function codexPosture({ writeScope, personaText, surfaceInstructions, beadsDir }: CodexPostureInput): CodexLaunchOptions {
  const parts = [personaText.trim(), surfaceInstructions?.trim()].filter(Boolean)
  const posture: CodexLaunchOptions = { mode: CODEX_MODES[writeScope], developerInstructions: parts.join('\n\n') }
  // bd runs inside the sandbox here, and its database lives in the main checkout, outside the worktree.
  if (beadsDir && posture.mode === 'workspace-write') posture.writableRoots = [beadsDir]
  return posture
}
