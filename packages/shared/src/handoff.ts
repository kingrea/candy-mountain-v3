export const HANDOFF_OUTCOMES = ['done', 'partial', 'blocked'] as const

export type HandoffOutcome = (typeof HANDOFF_OUTCOMES)[number]

export interface Handoff {
  outcome: HandoffOutcome
  summary: string
  pullRequest: string | null
  issues: string[]
  followUps: string[]
}

export type HandoffFailureReason =
  | 'missing'
  | 'malformed'
  | 'unknown_outcome'
  | 'missing_outcome'
  | 'missing_summary'

export type HandoffParseResult =
  | { ok: true; handoff: Handoff }
  | { ok: false; reason: HandoffFailureReason; message: string }

const OPEN_FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)\s*$/
const FIELD_LINE = /^\s*([A-Za-z_]+)\s*:\s*(.*?)\s*$/

function fail(reason: HandoffFailureReason, message: string): HandoffParseResult {
  return { ok: false, reason, message }
}

function isNone(value: string): boolean {
  return value === '' || value.toLowerCase() === 'none'
}

function splitList(value: string, separator: string): string[] {
  if (isNone(value)) return []
  return value
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part !== '' && part.toLowerCase() !== 'none')
}

interface HandoffBlock {
  body: string[]
  /** Line indexes of the opening and closing fences. */
  start: number
  end: number
}

// The last block wins: the final message may quote an earlier example first.
function findHandoffBlock(lines: string[]): HandoffBlock | 'unclosed' | null {
  let found: HandoffBlock | 'unclosed' | null = null
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN_FENCE.exec(lines[i]!)
    if (!open) continue
    const start = i
    const fence = open[1]!
    const isHandoff = open[2]!.toLowerCase() === 'handoff'
    const body: string[] = []
    let closed = false
    for (i++; i < lines.length; i++) {
      const line = lines[i]!.trim()
      if (line.startsWith(fence[0]!.repeat(fence.length)) && /^(`+|~+)$/.test(line)) {
        closed = true
        break
      }
      body.push(lines[i]!)
    }
    if (isHandoff) found = closed ? { body, start, end: i } : 'unclosed'
  }
  return found
}

const splitLines = (message: string) => message.split(/\r\n|\r|\n/)

/** The message without the block parseHandoff reads, for showing the prose next to a rendered handoff. */
export function stripHandoff(message: string): string {
  const lines = splitLines(message)
  const block = findHandoffBlock(lines)
  if (block === null || block === 'unclosed') return message
  return [...lines.slice(0, block.start), ...lines.slice(block.end + 1)].join('\n')
}

export function parseHandoff(message: string): HandoffParseResult {
  const block = findHandoffBlock(splitLines(message))
  if (block === null) return fail('missing', 'No handoff block found')
  if (block === 'unclosed') return fail('malformed', 'Handoff block is not closed')

  const fields = new Map<string, string>()
  for (const line of block.body) {
    if (line.trim() === '') continue
    const match = FIELD_LINE.exec(line)
    if (!match) return fail('malformed', `Unreadable handoff line: ${line.trim()}`)
    fields.set(match[1]!.toLowerCase(), match[2]!)
  }

  const rawOutcome = fields.get('outcome')
  if (rawOutcome === undefined || rawOutcome === '') {
    return fail('missing_outcome', 'Handoff has no outcome')
  }
  const outcome = rawOutcome.toLowerCase()
  if (!(HANDOFF_OUTCOMES as readonly string[]).includes(outcome)) {
    return fail('unknown_outcome', `Unknown handoff outcome: ${rawOutcome}`)
  }

  const summary = fields.get('summary') ?? ''
  if (isNone(summary)) return fail('missing_summary', 'Handoff has no summary')

  const pullRequest = fields.get('pull_request') ?? ''
  return {
    ok: true,
    handoff: {
      outcome: outcome as HandoffOutcome,
      summary,
      pullRequest: isNone(pullRequest) ? null : pullRequest,
      issues: splitList(fields.get('issues') ?? '', ','),
      followUps: splitList(fields.get('follow_ups') ?? '', ';'),
    },
  }
}
