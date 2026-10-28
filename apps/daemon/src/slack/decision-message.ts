import { DECISION_META_KEY } from '@candy-mountain/claude-acp'
import type { AnswerDecisionRequest, Decision, DecisionOption } from '@candy-mountain/shared'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

/** Buttons carry this action id prefix; the value is `<decision id>:<choice number>`. */
export const SLACK_DECISION_ACTION = 'cm-decision'

/** Slack allows 25 elements in an actions block; one is kept for Decline. */
const MAX_CHOICES = 24
const BUTTON_TEXT_MAX = 75

export const slackDecisionShortId = (decisionId: string) => decisionId.replaceAll('-', '').slice(0, 6).toLowerCase()

export const escapeSlackText = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

export interface SlackQuestionField {
  key: string
  title: string
  type: 'text' | 'number' | 'integer' | 'boolean' | 'choice' | 'multi'
  choices: { value: string, label: string }[]
  freeText: boolean
}

function choicesOf(schema: Record<string, unknown>): { value: string, label: string }[] | null {
  if (Array.isArray(schema.enum)) return schema.enum.filter((value): value is string => typeof value === 'string').map(value => ({ value, label: value }))
  const list = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null
  if (!list) return null
  return list.flatMap(entry => (isRecord(entry) && typeof entry.const === 'string' ? [{ value: entry.const, label: text(entry.title) ?? entry.const }] : []))
}

export function slackQuestionFields(decision: Decision): SlackQuestionField[] {
  const request = decision.request ?? {}
  const schema = isRecord(request.requestedSchema) ? request.requestedSchema : {}
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const meta = isRecord(request._meta) ? request._meta[DECISION_META_KEY] : undefined
  const freeText = new Set(isRecord(meta) && Array.isArray(meta.freeText) ? meta.freeText : [])
  return Object.entries(properties).flatMap(([key, property]): SlackQuestionField[] => {
    if (!isRecord(property)) return []
    const field = { key, title: text(property.title) ?? key, choices: [] as SlackQuestionField['choices'], freeText: freeText.has(key) }
    if (property.type === 'string') {
      const choices = choicesOf(property)
      return [choices ? { ...field, type: 'choice', choices } : { ...field, type: 'text' }]
    }
    if (property.type === 'number' || property.type === 'integer' || property.type === 'boolean') return [{ ...field, type: property.type }]
    const items = property.type === 'array' && isRecord(property.items) ? choicesOf(property.items) : null
    return items ? [{ ...field, type: 'multi', choices: items }] : []
  })
}

/** The rule an always-allow would save, preferring the agent's own payload over its option label. */
export function slackProposedRule(option: DecisionOption): string {
  const rule = option.meta?.rule
  if (typeof rule === 'string' && rule.trim()) return rule
  return option.label.replace(/^always allow\s*/i, '') || option.label
}

export interface SlackDecisionChoice {
  label: string
  style: 'primary' | 'danger' | null
  request: AnswerDecisionRequest
}

const KIND_ORDER: DecisionOption['kind'][] = ['allow_once', 'allow_always', 'answer', 'deny']

/** Buttons and `choose <id> <n>` both index this list, so a number always means the same choice. */
export function slackDecisionChoices(decision: Decision): SlackDecisionChoice[] {
  const byId = (option: DecisionOption): AnswerDecisionRequest => ({ optionKind: option.kind, ...(option.optionId === null ? {} : { optionId: option.optionId }) })
  if (decision.kind === 'permission') {
    const options = [...decision.options].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    return options.map((option): SlackDecisionChoice => {
      if (option.kind === 'allow_once') return { label: 'Allow once', style: 'primary', request: byId(option) }
      if (option.kind === 'allow_always') return { label: `Always allow ${slackProposedRule(option)}`, style: null, request: byId(option) }
      return { label: 'Deny', style: 'danger', request: byId(option) }
    })
  }
  const fields = slackQuestionFields(decision)
  const answers: SlackDecisionChoice[] = []
  const only = fields.length === 1 ? fields[0]! : null
  if (only?.type === 'choice') {
    for (const choice of only.choices.slice(0, MAX_CHOICES)) answers.push({ label: choice.label, style: null, request: { optionKind: 'answer', answer: { [only.key]: choice.value } } })
  }
  else if (only?.type === 'boolean') {
    answers.push({ label: 'Yes', style: null, request: { optionKind: 'answer', answer: { [only.key]: true } } }, { label: 'No', style: null, request: { optionKind: 'answer', answer: { [only.key]: false } } })
  }
  return [...answers, { label: 'Decline', style: 'danger', request: { optionKind: 'deny' } }]
}

export type Parsed<T> = { ok: true, value: T } | { ok: false, reason: string }

const BOOLEANS: Record<string, boolean> = { yes: true, y: true, true: true, 1: true, no: false, n: false, false: false, 0: false }

function fieldValue(field: SlackQuestionField, raw: string): Parsed<unknown> {
  const value = raw.trim()
  const pick = (input: string) => field.choices.find(choice => choice.value.toLowerCase() === input.toLowerCase() || choice.label.toLowerCase() === input.toLowerCase())?.value
  switch (field.type) {
    case 'number':
    case 'integer': {
      const number = Number(value)
      return value && Number.isFinite(number) ? { ok: true, value: number } : { ok: false, reason: `"${field.title}" needs a number` }
    }
    case 'boolean': {
      const flag = BOOLEANS[value.toLowerCase()]
      return flag === undefined ? { ok: false, reason: `"${field.title}" needs yes or no` } : { ok: true, value: flag }
    }
    case 'choice': {
      const chosen = pick(value)
      if (chosen !== undefined) return { ok: true, value: chosen }
      return field.freeText ? { ok: true, value } : { ok: false, reason: `"${field.title}" must be one of ${field.choices.map(choice => choice.label).join(', ')}` }
    }
    case 'multi': {
      const values = value.split(',').map(part => part.trim()).filter(Boolean)
      const chosen = values.map(pick)
      const unknown = values.find((_, index) => chosen[index] === undefined)
      return unknown === undefined ? { ok: true, value: chosen } : { ok: false, reason: `"${unknown}" is not a choice for "${field.title}"` }
    }
    default:
      return { ok: true, value }
  }
}

/** One field takes the whole text; several take one `Title: value` line each. */
export function slackAnswerFromText(decision: Decision, input: string): Parsed<Record<string, unknown>> {
  const fields = slackQuestionFields(decision)
  if (fields.length === 0) return { ok: false, reason: 'This question has no fields that can be answered from Slack.' }
  if (fields.length === 1) {
    const value = fieldValue(fields[0]!, input)
    return value.ok ? { ok: true, value: { [fields[0]!.key]: value.value } } : value
  }
  const answer: Record<string, unknown> = {}
  for (const line of input.split('\n')) {
    const match = /^\s*([^:]+?)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const name = match[1]!.toLowerCase()
    const field = fields.find(candidate => candidate.key.toLowerCase() === name || candidate.title.toLowerCase() === name)
    if (!field) return { ok: false, reason: `"${match[1]}" is not a field of this question` }
    const value = fieldValue(field, match[2]!)
    if (!value.ok) return value
    answer[field.key] = value.value
  }
  if (Object.keys(answer).length === 0) return { ok: false, reason: `Answer each field on its own line, such as "${fields[0]!.title}: …"` }
  return { ok: true, value: answer }
}

export type SlackDecisionVerb = 'yes' | 'no' | 'choose' | 'answer'

export interface SlackDecisionReply {
  verb: SlackDecisionVerb
  /** The words after the verb; which one is the decision id is settled against the thread's decisions. */
  words: string[]
  /** Everything after the first word, line breaks kept, for reasons and answers. */
  rest: string
}

export function parseSlackDecisionReply(input: string): SlackDecisionReply | null {
  const match = /^\s*[*_~`]*(yes|no|choose|answer)[*_~`]*\s+(\S+)(?:[ \t]+|\n|$)([\s\S]*)$/i.exec(input)
  if (!match) return null
  const first = match[2]!.replace(/[*_~`.,!]+$/g, '').replace(/^[*_~`]+/g, '')
  const rest = match[3]!.trim()
  return { verb: match[1]!.toLowerCase() as SlackDecisionVerb, words: [first, ...rest.split(/\s+/).filter(Boolean)], rest }
}

function permissionSummary(decision: Decision): string {
  const call = decision.toolCall ?? {}
  const title = text(call.title) ?? 'A tool call'
  const input = isRecord(call.rawInput) ? call.rawInput : null
  const command = input ? text(input.command) ?? text(input.file_path) ?? text(input.path) : null
  const lines = [escapeSlackText(clip(title, 300))]
  if (command && command !== title) lines.push(`\`\`\`${escapeSlackText(clip(command, 1500))}\`\`\``)
  return lines.join('\n')
}

function questionSummary(decision: Decision): string {
  const message = text(decision.request?.message) ?? 'The agent has a question.'
  const fields = slackQuestionFields(decision)
  const lines = [escapeSlackText(clip(message, 1500))]
  if (fields.length > 1) {
    for (const field of fields) lines.push(`• *${escapeSlackText(field.title)}*${field.choices.length ? `: ${escapeSlackText(field.choices.map(choice => choice.label).join(', '))}` : ''}`)
  }
  return lines.join('\n')
}

function actorLabel(actorId: string): string {
  return actorId.startsWith('slack:') ? `by <@${actorId.slice('slack:'.length)}> in Slack` : 'in the web app'
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

/** The same wording as the chat panel's decision card. */
export function slackDecisionOutcome(decision: Decision): { label: string, detail: string | null } | null {
  if (decision.state === 'expired' && decision.expiry) {
    return { label: decision.expiry.reason === 'cancelled' ? 'Withdrawn' : 'Refused', detail: decision.expiry.message }
  }
  const answer = decision.answer
  if (decision.state !== 'answered' || !answer) return null
  const by = actorLabel(answer.actorId)
  switch (answer.optionKind) {
    case 'allow_once':
      return { label: `Allowed once ${by}`, detail: null }
    case 'allow_always': {
      const option = decision.options.find(candidate => candidate.kind === 'allow_always' && (answer.optionId === null || candidate.optionId === answer.optionId))
      return { label: `Always allowed ${by}`, detail: option ? slackProposedRule(option) : null }
    }
    case 'deny':
      return { label: `${decision.kind === 'question' ? 'Declined' : 'Denied'} ${by}`, detail: answer.explanation }
    case 'answer': {
      const fields = slackQuestionFields(decision)
      const detail = Object.entries(answer.answer ?? {}).map(([key, value]) => `${fields.find(field => field.key === key)?.title ?? key}: ${formatValue(value)}`).join('\n')
      return { label: `Answered ${by}`, detail: detail || null }
    }
  }
}

export interface SlackDecisionMessage {
  text: string
  blocks: Record<string, unknown>[]
}

export function slackDecisionMessage(decision: Decision): SlackDecisionMessage {
  const short = slackDecisionShortId(decision.id)
  const heading = decision.kind === 'permission' ? 'Permission needed' : 'Question'
  const summary = decision.kind === 'permission' ? permissionSummary(decision) : questionSummary(decision)
  const blocks: Record<string, unknown>[] = [{ type: 'section', text: { type: 'mrkdwn', text: `*${heading}* \`${short}\`\n${summary}` } }]
  const outcome = slackDecisionOutcome(decision)
  const plain = `${heading} (${short})`

  if (outcome) {
    const detail = outcome.detail ? `\n${escapeSlackText(clip(outcome.detail, 1500))}` : ''
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${outcome.label}*${detail}` } })
    return { text: `${plain}: ${outcome.label.replace(/<@(\w+)>/g, '$1')}`, blocks }
  }

  const choices = slackDecisionChoices(decision)
  blocks.push({
    type: 'actions',
    block_id: `${SLACK_DECISION_ACTION}:${decision.id}`,
    elements: choices.map((choice, index) => ({
      type: 'button',
      action_id: `${SLACK_DECISION_ACTION}:${index + 1}`,
      text: { type: 'plain_text', text: clip(`${index + 1}. ${choice.label}`, BUTTON_TEXT_MAX) },
      value: `${decision.id}:${index + 1}`,
      ...(choice.style ? { style: choice.style } : {}),
    })),
  })
  const verbs = decision.kind === 'permission'
    ? `\`yes ${short}\`, \`no ${short} <reason>\` or \`choose ${short} <number>\``
    : `\`answer ${short} <text>\`, \`choose ${short} <number>\` or \`no ${short}\` to decline`
  const expires = Math.floor(Date.parse(decision.expiresAt) / 1000)
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Or reply ${verbs}. Refused if nobody answers by <!date^${expires}^{time}|${decision.expiresAt}>.` }] })
  return { text: `${plain}: ${decision.kind === 'permission' ? text(decision.toolCall?.title) ?? 'a tool call' : text(decision.request?.message) ?? 'the agent has a question'}`, blocks }
}
