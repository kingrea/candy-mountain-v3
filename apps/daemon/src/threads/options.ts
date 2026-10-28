import type { SessionConfigOption, SessionConfigSelectOption } from '@agentclientprotocol/sdk'
import type { AgentSessionFamily, AgentSessionPosture, ChatOption } from '@candy-mountain/shared'
import { ThreadError } from './errors'

export interface FamilyOptions {
  models: ChatOption[]
  efforts: ChatOption[]
}

/** The CLI resolves each alias to the latest model of that tier. */
const CLAUDE_MODELS: ChatOption[] = [
  { value: 'opus', label: 'Opus', description: 'The most capable model.' },
  { value: 'sonnet', label: 'Sonnet', description: 'Balanced speed and capability.' },
  { value: 'haiku', label: 'Haiku', description: 'The fastest model.' },
]

const CLAUDE_EFFORTS: ChatOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

const CLAUDE_FULL_MODEL_ID = /^claude-[a-z0-9]+(?:[-.][a-z0-9]+)*$/

/** The config option sets an agent reported, one per model it ran with, latest last (SessionManager.configOptions). */
export type ConfigOptionSets = readonly (readonly SessionConfigOption[])[]

interface Catalog extends FamilyOptions {
  /** Efforts each model is known to accept; a model missing here has not run yet. */
  effortsByModel: Map<string, Set<string>>
}

function selectOptions(sets: ConfigOptionSets, category: string): Array<{ model: unknown, options: SessionConfigSelectOption[] }> {
  return sets.flatMap((set) => {
    const option = set.find(candidate => candidate.category === category && candidate.type === 'select')
    if (option?.type !== 'select') return []
    const options = option.options.flatMap(entry => ('group' in entry ? entry.options : [entry]))
    return [{ model: set.find(candidate => candidate.category === 'model')?.currentValue, options }]
  })
}

const toChatOption = (option: SessionConfigSelectOption): ChatOption => ({ value: option.value, label: option.name, ...(option.description ? { description: option.description } : {}) })

/** Codex lists its models and efforts only over ACP once a session is up, so nothing is offered before one has run. */
function codexCatalog(sets: ConfigOptionSets): Catalog {
  const models = selectOptions(sets, 'model').at(-1)?.options.map(toChatOption) ?? []
  const efforts = new Map<string, ChatOption>()
  const effortsByModel = new Map<string, Set<string>>()
  for (const { model, options } of selectOptions(sets, 'thought_level')) {
    for (const option of options) {
      if (!efforts.has(option.value)) efforts.set(option.value, toChatOption(option))
    }
    if (typeof model === 'string') effortsByModel.set(model, new Set(options.map(option => option.value)))
  }
  return { models, efforts: [...efforts.values()], effortsByModel }
}

function catalog(family: AgentSessionFamily, sets: ConfigOptionSets): Catalog {
  if (family === 'codex') return codexCatalog(sets)
  if (family === 'platform') return { models: [], efforts: [], effortsByModel: new Map() }
  return { models: structuredClone(CLAUDE_MODELS), efforts: structuredClone(CLAUDE_EFFORTS), effortsByModel: new Map() }
}

export function familyOptions(family: AgentSessionFamily, sets: ConfigOptionSets = []): FamilyOptions {
  const { models, efforts } = catalog(family, sets)
  return { models, efforts }
}

/** A value equal to `kept` was accepted earlier, so it stays valid even when the agent's list is gone after a restart. */
export function assertModelEffort(family: AgentSessionFamily, model: string | null, effort: string | null, sets: ConfigOptionSets = [], kept: { model: string | null, effort: string | null } = { model: null, effort: null }): void {
  const { models, efforts, effortsByModel } = catalog(family, sets)
  if (model !== null && model !== kept.model) {
    if (!models.length) throw new ThreadError('invalid_request', 'This agent offers no model choice')
    const known = models.some(option => option.value === model) || (family === 'claude-code' && CLAUDE_FULL_MODEL_ID.test(model))
    if (!known) throw new ThreadError('invalid_request', `model must be one of ${models.map(option => option.value).join(', ')}`)
  }
  if (effort !== null && effort !== kept.effort) {
    if (!efforts.length) throw new ThreadError('invalid_request', 'This agent offers no effort choice')
    if (!efforts.some(option => option.value === effort)) throw new ThreadError('invalid_request', `effort must be one of ${efforts.map(option => option.value).join(', ')}`)
  }
  const accepted = model === null ? undefined : effortsByModel.get(model)
  if (effort !== null && accepted && !accepted.has(effort) && (model !== kept.model || effort !== kept.effort)) {
    throw new ThreadError('invalid_request', `model ${model} accepts effort ${[...accepted].join(', ')}`)
  }
}

/** Claude effort travels as the `effortLevel` setting because the CLI has no flag for it. */
export function chatPosture(family: AgentSessionFamily, model: string | null, effort: string | null): AgentSessionPosture | null {
  if (model === null && effort === null) return null
  if (family === 'codex') return { codex: { ...(model === null ? {} : { model }), ...(effort === null ? {} : { reasoningEffort: effort }) } }
  const flags: string[] = []
  if (model !== null) flags.push('--model', model)
  if (effort !== null) flags.push('--settings', JSON.stringify({ effortLevel: effort }))
  return { flags }
}
