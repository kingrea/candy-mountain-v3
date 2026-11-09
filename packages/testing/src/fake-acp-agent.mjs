// A stdio ACP agent with scripted replies, for tests that need the wire but not a real CLI.
import { spawn } from 'node:child_process'
import readline from 'node:readline'

const write = value => process.stdout.write(JSON.stringify(value) + '\n')
const reply = (id, result) => write({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } })
const notify = (method, params) => write({ jsonrpc: '2.0', method, params })
const update = (sessionId, body) => notify('session/update', { sessionId, update: body })
const text = (sessionId, value) => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } })

let nextId = 1
const outstanding = new Map()
const request = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++
  outstanding.set(id, { resolve, reject })
  write({ jsonrpc: '2.0', id, method, params })
})

let hang
const sessions = new Set()
const promptHistory = new Map()
const sessionDirectories = new Map()

// Shaped like codex-acp's config options: the efforts on offer depend on the current model, which CODEX_CONFIG picks.
const MODELS = [
  { id: 'gpt-fast', name: 'Fast', description: 'Quick answers.', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  { id: 'gpt-deep', name: 'Deep', description: 'Long reasoning.', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high' },
]
const codexConfig = process.env.CODEX_CONFIG ? JSON.parse(process.env.CODEX_CONFIG) : {}
const currentModel = MODELS.find(model => model.id === codexConfig.model) ?? MODELS[0]
const currentEffort = currentModel.efforts.includes(codexConfig.model_reasoning_effort) ? codexConfig.model_reasoning_effort : currentModel.defaultEffort

function configOptions() {
  if (process.env.FAKE_ACP_CONFIG === 'none') return undefined
  return [
    { id: 'mode', name: 'Approval Preset', category: 'mode', type: 'select', currentValue: 'read-only', options: [{ value: 'read-only', name: 'Read Only' }, { value: 'agent', name: 'Agent' }] },
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: currentModel.id, options: MODELS.map(model => ({ value: model.id, name: model.name, description: model.description })) },
    { id: 'reasoning_effort', name: 'Reasoning effort', category: 'thought_level', type: 'select', currentValue: currentEffort, options: currentModel.efforts.map(effort => ({ value: effort, name: effort[0].toUpperCase() + effort.slice(1), description: null })) },
  ]
}

async function prompt(id, params) {
  const { sessionId } = params
  const input = params.prompt.find(block => block.type === 'text')?.text ?? ''
  const history = promptHistory.get(sessionId) ?? []
  history.push(input)
  promptHistory.set(sessionId, history)
  switch (input) {
    case 'crash':
      process.exit(3)
      break
    case 'env':
      text(sessionId, JSON.stringify(Object.keys(process.env).sort()))
      break
    case 'directories':
      text(sessionId, JSON.stringify(sessionDirectories.get(sessionId) ?? null))
      break
    case 'spawn-child': {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
      text(sessionId, String(child.pid))
      break
    }
    case 'history':
      text(sessionId, JSON.stringify(history))
      break
    case 'model':
      text(sessionId, `model:${currentModel.id}/${currentEffort}`)
      break
    case 'think':
      update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'pondering' } })
      text(sessionId, 'thought about it')
      break
    case 'tool':
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'ls', kind: 'execute', status: 'in_progress', rawInput: { command: 'ls' } })
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'a\nb' } }] })
      text(sessionId, 'listed')
      break
    case 'usage':
      update(sessionId, { sessionUpdate: 'usage_update', used: 1200, size: 200000 })
      update(sessionId, { sessionUpdate: 'current_mode_update', currentModeId: 'default' })
      text(sessionId, 'usage sent')
      break
    case 'permission': {
      const outcome = await request('session/request_permission', {
        sessionId,
        toolCall: { toolCallId: 'call-2', title: 'rm -rf build', kind: 'delete', status: 'pending' },
        options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject', name: 'Deny', kind: 'reject_once' }],
      })
      text(sessionId, `permission:${JSON.stringify(outcome.outcome)}`)
      break
    }
    case 'guarded-tool':
    case 'guarded-rules': {
      update(sessionId, { sessionUpdate: 'tool_call', toolCallId: 'call-3', title: 'touch scratch.txt', kind: 'edit', status: 'pending', rawInput: { path: 'scratch.txt' } })
      const options = input === 'guarded-rules'
        ? [
            { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'rule-0', name: 'Always allow Edit(scratch.txt)', kind: 'allow_always', _meta: { rule: 'Edit(scratch.txt)' } },
            { optionId: 'rule-1', name: 'Always allow Edit(*)', kind: 'allow_always', _meta: { rule: 'Edit(*)' } },
            { optionId: 'review', name: 'Yes, grant for this turn with strict auto review', kind: 'allow_once' },
            { optionId: 'no', name: 'Deny', kind: 'reject_once' },
          ]
        : [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'no', name: 'Deny', kind: 'reject_once' }]
      const { outcome } = await request('session/request_permission', { sessionId, toolCall: { toolCallId: 'call-3', title: 'touch scratch.txt', kind: 'edit', status: 'pending' }, options })
      const chosen = outcome.outcome === 'selected' ? options.find(option => option.optionId === outcome.optionId) : undefined
      const allowed = chosen?.kind === 'allow_once' || chosen?.kind === 'allow_always'
      update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'call-3', status: allowed ? 'completed' : 'failed' })
      text(sessionId, allowed ? `ran:${chosen.optionId}` : `skipped:${JSON.stringify(outcome)}`)
      break
    }
    case 'question': {
      const answer = await request('elicitation/create', {
        sessionId,
        mode: 'form',
        message: 'Which formatter?',
        requestedSchema: { type: 'object', properties: { formatter: { type: 'string', oneOf: [{ const: 'prettier', title: 'Prettier' }, { const: 'dprint', title: 'dprint' }] } } },
      })
      text(sessionId, `question:${JSON.stringify(answer)}`)
      break
    }
    case 'hang':
      text(sessionId, 'working')
      await new Promise((resolve) => { hang = resolve })
      hang = undefined
      return reply(id, { stopReason: 'cancelled' })
    case 'expired':
      return fail(id, -32000, 'Authentication required: login expired')
    case 'error':
      return fail(id, -32603, 'Internal error: the model is unavailable')
    default:
      if (input.startsWith('env:')) text(sessionId, JSON.stringify(Object.fromEntries(input.slice(4).split(',').map(name => [name, process.env[name] ?? null]))))
      else text(sessionId, `echo: ${input}`)
  }
  reply(id, { stopReason: 'end_turn', usage: { totalTokens: 12, inputTokens: 10, outputTokens: 2 } })
}

const lines = readline.createInterface({ input: process.stdin })
for await (const line of lines) {
  if (!line.trim()) continue
  const message = JSON.parse(line)
  if (message.id !== undefined && message.method === undefined) {
    const pending = outstanding.get(message.id)
    outstanding.delete(message.id)
    if (message.error) pending?.reject(new Error(message.error.message))
    else pending?.resolve(message.result)
    continue
  }
  const { id, method, params } = message
  switch (method) {
    case 'initialize':
      reply(id, { protocolVersion: 1, agentInfo: { name: 'fake-acp-agent', version: '0.0.0' }, agentCapabilities: { loadSession: true }, authMethods: [] })
      break
    case 'session/new': {
      if (process.env.FAKE_ACP_AUTH === 'none') { fail(id, -32000, 'Authentication required'); break }
      if (process.env.FAKE_ACP_START === 'crash') process.exit(5)
      const sessionId = `fake-${nextId++}`
      sessions.add(sessionId)
      sessionDirectories.set(sessionId, params.additionalDirectories ?? null)
      reply(id, { sessionId, configOptions: configOptions() })
      break
    }
    case 'session/load': {
      const { sessionId } = params
      if (!sessionId.startsWith('fake-')) { fail(id, -32602, `Unknown session ${sessionId}`); break }
      sessions.add(sessionId)
      sessionDirectories.set(sessionId, params.additionalDirectories ?? null)
      promptHistory.set(sessionId, ['(loaded)'])
      update(sessionId, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'earlier prompt' } })
      text(sessionId, 'earlier answer')
      reply(id, { configOptions: configOptions() })
      break
    }
    case 'session/prompt':
      void prompt(id, params)
      break
    case 'session/cancel':
      hang?.()
      break
    case '$/cancel_request':
      break
    default:
      if (id !== undefined) fail(id, -32601, `Method not found: ${method}`)
  }
}
