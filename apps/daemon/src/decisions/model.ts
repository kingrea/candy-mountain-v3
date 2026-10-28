import type { CreateElicitationResponse, RequestPermissionResponse } from '@agentclientprotocol/sdk'
import { DECISION_META_KEY } from '@candy-mountain/claude-acp'
import type { AcpObject, DecisionOption } from '@candy-mountain/shared'

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const metaOf = (value: Record<string, unknown>): AcpObject | null => (isRecord(value._meta) ? value._meta : null)

/** Codex offers "grant with strict auto review", which hands the next approvals to its own reviewer. */
const AUTO_REVIEW = /auto[\s_-]*review/i

const DENY_FALLBACK: DecisionOption = { kind: 'deny', optionId: null, label: 'Deny', meta: null }

export type Built<T> = { ok: true, value: T } | { ok: false, reason: string }

export function permissionOptions(offered: unknown): Built<DecisionOption[]> {
  if (!Array.isArray(offered)) return { ok: false, reason: 'The agent sent no list of options.' }
  const seen = new Set<string>()
  const options: DecisionOption[] = []
  for (const option of offered) {
    if (!isRecord(option) || typeof option.optionId !== 'string' || typeof option.name !== 'string' || typeof option.kind !== 'string') return { ok: false, reason: 'The agent sent a malformed option.' }
    if (seen.has(option.optionId)) return { ok: false, reason: `The agent offered option id "${option.optionId}" twice.` }
    seen.add(option.optionId)
    if (AUTO_REVIEW.test(option.optionId) || AUTO_REVIEW.test(option.name)) continue
    const kind = option.kind === 'allow_once' || option.kind === 'allow_always' ? option.kind : option.kind === 'reject_once' ? 'deny' : null
    if (kind) options.push({ kind, optionId: option.optionId, label: option.name, meta: metaOf(option) })
  }
  // Deny must always be possible; a cancelled outcome is a denial to both agents.
  if (!options.some(option => option.kind === 'deny')) options.push(DENY_FALLBACK)
  return { ok: true, value: options }
}

type PropertySchema = Record<string, unknown> & { type: string }

function choicesOf(schema: Record<string, unknown>): string[] | null {
  if (Array.isArray(schema.enum)) return schema.enum.filter((value): value is string => typeof value === 'string')
  const list = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null
  return list ? list.flatMap(entry => (isRecord(entry) && typeof entry.const === 'string' ? [entry.const] : [])) : null
}

function supported(schema: unknown): schema is PropertySchema {
  if (!isRecord(schema)) return false
  if (schema.type === 'string' || schema.type === 'number' || schema.type === 'integer' || schema.type === 'boolean') return true
  return schema.type === 'array' && isRecord(schema.items) && choicesOf(schema.items) !== null
}

interface FormSchema {
  properties: Record<string, PropertySchema>
  required: string[]
}

export function questionForm(request: unknown): Built<FormSchema> {
  if (!isRecord(request)) return { ok: false, reason: 'The question was malformed.' }
  if (request.mode !== undefined && request.mode !== 'form') return { ok: false, reason: `Only form questions can be answered, not "${String(request.mode)}".` }
  const schema = request.requestedSchema
  if (!isRecord(schema) || !isRecord(schema.properties) || Object.keys(schema.properties).length === 0) return { ok: false, reason: 'The question has no fields to answer.' }
  for (const [key, property] of Object.entries(schema.properties)) {
    if (!supported(property)) return { ok: false, reason: `The question field "${key}" has a type that cannot be answered.` }
  }
  const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : []
  return { ok: true, value: { properties: schema.properties as Record<string, PropertySchema>, required } }
}

export const QUESTION_OPTIONS: DecisionOption[] = [
  { kind: 'answer', optionId: null, label: 'Answer', meta: null },
  { kind: 'deny', optionId: null, label: 'Decline', meta: null },
]

/** Fields the agent marked as accepting free text even though it suggested choices. */
function freeTextKeys(request: Record<string, unknown>): Set<string> {
  const meta = isRecord(request._meta) ? request._meta[DECISION_META_KEY] : undefined
  return new Set(isRecord(meta) && Array.isArray(meta.freeText) ? meta.freeText.filter((key): key is string => typeof key === 'string') : [])
}

function checkValue(key: string, schema: PropertySchema, value: unknown, freeText: boolean): string | null {
  const bounded = (n: number, min: unknown, max: unknown) => (typeof min === 'number' && n < min) || (typeof max === 'number' && n > max)
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') return `"${key}" must be a string`
      if (bounded(value.length, schema.minLength, schema.maxLength)) return `"${key}" has the wrong length`
      const choices = choicesOf(schema)
      if (choices && !freeText && !choices.includes(value)) return `"${key}" must be one of ${choices.join(', ')}`
      return null
    }
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) return `"${key}" must be ${schema.type === 'integer' ? 'an integer' : 'a number'}`
      return bounded(value, schema.minimum, schema.maximum) ? `"${key}" is out of range` : null
    case 'boolean':
      return typeof value === 'boolean' ? null : `"${key}" must be true or false`
    default: {
      if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) return `"${key}" must be a list of strings`
      if (bounded(value.length, schema.minItems, schema.maxItems)) return `"${key}" has the wrong number of choices`
      const choices = choicesOf(schema.items as Record<string, unknown>) ?? []
      const unknown = value.find(item => !choices.includes(item))
      return unknown === undefined ? null : `"${unknown}" is not a choice for "${key}"`
    }
  }
}

export function checkAnswer(request: unknown, answer: unknown): Built<Record<string, unknown>> {
  const form = questionForm(request)
  if (!form.ok) return form
  if (!isRecord(answer)) return { ok: false, reason: 'answer must be an object of field values' }
  const freeText = freeTextKeys(request as Record<string, unknown>)
  for (const [key, value] of Object.entries(answer)) {
    const schema = Object.hasOwn(form.value.properties, key) ? form.value.properties[key] : undefined
    if (!schema) return { ok: false, reason: `"${key}" is not a field of this question` }
    const problem = checkValue(key, schema, value, freeText.has(key))
    if (problem) return { ok: false, reason: problem }
  }
  for (const key of form.value.required) {
    const value = answer[key]
    if (value === undefined || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)) return { ok: false, reason: `"${key}" is required` }
  }
  return { ok: true, value: answer }
}

export const REFUSE_PERMISSION: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } }
export const REFUSE_QUESTION: CreateElicitationResponse = { action: 'cancel' }

export function permissionResponse(option: DecisionOption, explanation: string | null): RequestPermissionResponse {
  const meta = explanation ? { _meta: { [DECISION_META_KEY]: { explanation } } } : {}
  if (option.optionId === null) return { ...REFUSE_PERMISSION, ...meta }
  return { outcome: { outcome: 'selected', optionId: option.optionId }, ...meta }
}
