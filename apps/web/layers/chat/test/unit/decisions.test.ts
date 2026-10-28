import type { Decision } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { chatDecisionOptions, chatDecisionOutcome, chatProposedRule, chatQuestionAnswer, chatQuestionComplete, chatQuestionForm } from '../../app/utils/chatDecisions'
import { decision } from './fixtures'

const answered = (extra: Partial<NonNullable<Decision['answer']>>): Partial<Decision> => ({
  state: 'answered',
  answer: { optionKind: 'allow_once', optionId: null, answer: null, explanation: null, surface: 'web', actorId: 'me', at: 'now', ...extra },
})

const question = decision({
  kind: 'question',
  toolCall: null,
  request: {
    message: 'Before I continue',
    requestedSchema: {
      type: 'object',
      properties: {
        formatter: { type: 'string', title: 'Formatter', oneOf: [{ const: 'prettier', title: 'Prettier', description: 'Opinionated' }, { const: 'dprint' }] },
        tabs: { type: 'boolean' },
        width: { type: 'integer', title: 'Width' },
        langs: { type: 'array', items: { enum: ['ts', 'vue'] } },
        why: { type: 'string' },
        weird: { type: 'object' },
      },
      required: ['formatter'],
    },
    _meta: { 'clanker-corner': { freeText: ['formatter'] } },
  },
  options: [{ kind: 'answer', optionId: null, label: 'Answer', meta: null }, { kind: 'deny', optionId: null, label: 'Decline', meta: null }],
})

describe('chatQuestionForm', () => {
  it('reads the fields the daemon accepts and marks free-text choices', () => {
    const form = chatQuestionForm(question)
    expect(form.message).toBe('Before I continue')
    expect(form.fields.map(field => [field.key, field.type, field.required, field.freeText])).toEqual([
      ['formatter', 'choice', true, true],
      ['tabs', 'boolean', false, false],
      ['width', 'integer', false, false],
      ['langs', 'multi', false, false],
      ['why', 'text', false, false],
    ])
    expect(form.fields[0]!.choices).toEqual([{ value: 'prettier', label: 'Prettier', description: 'Opinionated' }, { value: 'dprint', label: 'dprint' }])
  })

  it('builds a typed answer and leaves blank optional fields out', () => {
    const form = chatQuestionForm(question)
    const answer = chatQuestionAnswer(form, { formatter: ' biome ', tabs: false, width: '80', langs: [], why: '  ' })
    expect(answer).toEqual({ formatter: 'biome', tabs: false, width: 80 })
    expect(chatQuestionComplete(form, answer)).toBe(true)
    expect(chatQuestionComplete(form, chatQuestionAnswer(form, { why: 'x' }))).toBe(false)
  })
})

describe('chatDecisionOutcome', () => {
  it('is null while pending', () => {
    expect(chatDecisionOutcome(decision())).toBeNull()
  })

  it('says who answered and how', () => {
    expect(chatDecisionOutcome(decision(answered({})), 'me')).toEqual({ label: 'Allowed once by you', detail: null, tone: 'success' })
    expect(chatDecisionOutcome(decision(answered({ optionKind: 'deny', explanation: 'not there', surface: 'slack', actorId: 'other' })), 'me'))
      .toEqual({ label: 'Denied in Slack', detail: 'not there', tone: 'error' })
    expect(chatDecisionOutcome({ ...question, ...answered({ optionKind: 'answer', answer: { formatter: 'dprint', langs: ['ts', 'vue'] } }) }, 'me'))
      .toEqual({ label: 'Answered by you', detail: 'Formatter: dprint\nlangs: ts, vue', tone: 'success' })
  })

  it('shows a timed-out decision as refused and a withdrawn one as withdrawn', () => {
    expect(chatDecisionOutcome(decision({ state: 'expired', expiry: { reason: 'timeout', message: 'Nobody answered in time, so the agent was refused.', at: 'now' } })))
      .toEqual({ label: 'Refused', detail: 'Nobody answered in time, so the agent was refused.', tone: 'error' })
    expect(chatDecisionOutcome(decision({ state: 'expired', expiry: { reason: 'cancelled', message: 'The turn ended.', at: 'now' } }))?.label).toBe('Withdrawn')
  })

  it('names the rule an always-allow saved', () => {
    const rules = decision({
      options: [
        { kind: 'allow_always', optionId: 'rule-0', label: 'Always allow Edit(scratch.txt)', meta: { rule: 'Edit(scratch.txt)' } },
        { kind: 'allow_always', optionId: 'rule-1', label: 'Always allow Bash(npm test) (this checkout, privately)', meta: null },
      ],
    })
    expect(chatDecisionOptions(rules, 'allow_always').map(chatProposedRule)).toEqual(['Edit(scratch.txt)', 'Bash(npm test) (this checkout, privately)'])
    expect(chatDecisionOutcome({ ...rules, ...answered({ optionKind: 'allow_always', optionId: 'rule-1' }) })?.detail).toBe('Bash(npm test) (this checkout, privately)')
  })
})
