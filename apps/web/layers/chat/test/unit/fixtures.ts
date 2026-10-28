import type { Decision } from '@candy-mountain/shared'

export function decision(extra: Partial<Decision> = {}): Decision {
  return {
    id: 'd1', sessionId: 's1', requestId: 'r1', kind: 'permission',
    toolCall: { toolCallId: 'call-1', title: 'Write: notes.txt', kind: 'edit', rawInput: { file_path: 'notes.txt' } },
    request: null,
    options: [
      { kind: 'allow_once', optionId: 'allow-once', label: 'Allow once', meta: null },
      { kind: 'deny', optionId: 'reject-once', label: 'Deny', meta: null },
    ],
    createdAt: '2026-10-28T10:00:00.000Z', expiresAt: '2026-10-28T10:05:00.000Z', state: 'pending', answer: null, expiry: null,
    ...extra,
  }
}
