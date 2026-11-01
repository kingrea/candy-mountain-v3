import type { Decision, DecisionOption } from '@candy-mountain/shared'

/** The extension key the daemon and the agent adapters put on a decision's `_meta`; the web app does not depend on the adapter package. */
export const CHAT_DECISION_META_KEY = 'clanker-corner'

export interface ChatQuestionChoice {
  value: string
  label: string
  description?: string
}

export interface ChatQuestionField {
  key: string
  title: string
  description: string | null
  type: 'text' | 'number' | 'integer' | 'boolean' | 'choice' | 'multi'
  choices: ChatQuestionChoice[]
  /** The choices are suggestions; any text is accepted. */
  freeText: boolean
  required: boolean
}

export interface ChatQuestionForm {
  message: string
  fields: ChatQuestionField[]
}

export interface ChatDecisionOutcome {
  label: string
  detail: string | null
  tone: 'success' | 'error' | 'neutral'
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

function choicesOf(schema: Record<string, unknown>): ChatQuestionChoice[] | null {
  if (Array.isArray(schema.enum)) {
    return schema.enum.filter((value): value is string => typeof value === 'string').map(value => ({ value, label: value }))
  }
  const list = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null
  if (!list) return null
  return list.flatMap((entry): ChatQuestionChoice[] => {
    if (!isRecord(entry) || typeof entry.const !== 'string') return []
    const description = text(entry.description)
    return [{ value: entry.const, label: text(entry.title) ?? entry.const, ...(description ? { description } : {}) }]
  })
}

export function chatQuestionForm(decision: Decision): ChatQuestionForm {
  const request = decision.request ?? {}
  const schema = isRecord(request.requestedSchema) ? request.requestedSchema : {}
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : [])
  const meta = isRecord(request._meta) ? request._meta[CHAT_DECISION_META_KEY] : undefined
  const freeText = new Set(isRecord(meta) && Array.isArray(meta.freeText) ? meta.freeText.filter((key): key is string => typeof key === 'string') : [])

  const fields = Object.entries(properties).flatMap(([key, property]): ChatQuestionField[] => {
    if (!isRecord(property)) return []
    const field = { key, title: text(property.title) ?? key, description: text(property.description), choices: [] as ChatQuestionChoice[], freeText: false, required: required.has(key) }
    switch (property.type) {
      case 'string': {
        const choices = choicesOf(property)
        return [choices ? { ...field, type: 'choice', choices, freeText: freeText.has(key) } : { ...field, type: 'text' }]
      }
      case 'number':
      case 'integer':
      case 'boolean':
        return [{ ...field, type: property.type }]
      case 'array': {
        const choices = isRecord(property.items) ? choicesOf(property.items) : null
        return choices ? [{ ...field, type: 'multi', choices }] : []
      }
      default:
        return []
    }
  })
  return { message: text(request.message) ?? 'The agent has a question.', fields }
}

/** Filled-in fields only, typed for the daemon's validation; blank optional fields are left out rather than sent empty. */
export function chatQuestionAnswer(form: ChatQuestionForm, values: Record<string, unknown>): Record<string, unknown> {
  const answer: Record<string, unknown> = {}
  for (const field of form.fields) {
    const value = values[field.key]
    if (value === undefined || value === null) continue
    if (field.type === 'number' || field.type === 'integer') {
      if (value === '') continue
      answer[field.key] = Number(value)
    }
    else if (field.type === 'boolean') answer[field.key] = Boolean(value)
    else if (field.type === 'multi') {
      if (Array.isArray(value) && value.length) answer[field.key] = value
    }
    else if (typeof value === 'string' && value.trim()) answer[field.key] = value.trim()
  }
  return answer
}

export function chatQuestionComplete(form: ChatQuestionForm, answer: Record<string, unknown>): boolean {
  return form.fields.every(field => !field.required || answer[field.key] !== undefined)
}

export function chatDecisionOptions(decision: Decision, kind: DecisionOption['kind']): DecisionOption[] {
  return decision.options.filter(option => option.kind === kind)
}

/** What a proposed always-allow rule would save, preferring the agent's own rule payload over its option label. */
export function chatProposedRule(option: DecisionOption): string {
  const rule = option.meta?.rule
  if (typeof rule === 'string' && rule.trim()) return rule
  return option.label.replace(/^always allow\s*/i, '') || option.label
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

export function chatDecisionOutcome(decision: Decision, viewerId?: string | null): ChatDecisionOutcome | null {
  if (decision.state === 'expired' && decision.expiry) {
    const label = decision.expiry.reason === 'cancelled' ? 'Withdrawn' : 'Refused'
    return { label, detail: decision.expiry.message, tone: label === 'Refused' ? 'error' : 'neutral' }
  }
  const answer = decision.answer
  if (decision.state !== 'answered' || !answer) return null
  const by = [viewerId && answer.actorId === viewerId ? ' by you' : '', answer.surface === 'slack' ? ' in Slack' : ''].join('')
  const option = decision.options.find(candidate => candidate.kind === answer.optionKind && (answer.optionId === null || candidate.optionId === answer.optionId))
  switch (answer.optionKind) {
    case 'allow_once':
      return { label: `Allowed once${by}`, detail: null, tone: 'success' }
    case 'allow_always':
      return { label: `Always allowed${by}`, detail: option ? chatProposedRule(option) : null, tone: 'success' }
    case 'deny':
      return { label: `${decision.kind === 'question' ? 'Declined' : 'Denied'}${by}`, detail: answer.explanation, tone: 'error' }
    case 'answer': {
      const form = chatQuestionForm(decision)
      const detail = Object.entries(answer.answer ?? {})
        .map(([key, value]) => `${form.fields.find(field => field.key === key)?.title ?? key}: ${formatValue(value)}`)
        .join('\n')
      return { label: `Answered${by}`, detail: detail || null, tone: 'success' }
    }
  }
}
