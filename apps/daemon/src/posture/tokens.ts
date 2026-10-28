/** Flags and values that hand an agent unrestricted approval; refused wherever they appear. */
export const BLANKET_BYPASS_TOKENS: readonly string[] = [
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  'bypassPermissions',
  '--dangerously-bypass-approvals-and-sandbox',
  '--yolo',
  'danger-full-access',
  '--full-auto',
  'agent-full-access',
]

export function findBypassToken(text: string): string | undefined {
  return BLANKET_BYPASS_TOKENS.find(token => text.includes(token))
}
