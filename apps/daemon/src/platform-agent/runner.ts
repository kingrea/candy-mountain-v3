import { PLATFORM_AGENT_ID, type AgentSessionEventPayload, type PlatformClientAction } from '@candy-mountain/shared'
import type { Mastra } from '@mastra/core'
import { RequestContext } from '@mastra/core/request-context'
import { loadRegistry, resolveCapabilityAccess, type CapabilityAccess, type RegistryDeps } from '../registry'
import type { SecretsStore } from '../secrets'
import { resolveLlmGatewayConfig } from '../settings/platform-settings'
import type { NativeFamilyRunner } from '../threads'
import { PLATFORM_TURN_KEY, type PlatformRequestContext, type PlatformTurnContext } from './context'

export interface PlatformAgentDeps extends RegistryDeps {
  secretsReader: SecretsStore
  mastra: Mastra
}

export interface PlatformAgentOptions {
  /** Streamed text is written to the log in slices no more often than this. */
  flushIntervalMs?: number
  maxSteps?: number
}

const TOOL_TITLES: Record<string, string> = { open_view: 'Open view', start_chat: 'Start chat', describe_platform: 'Describe platform' }

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function actionOf(result: unknown): PlatformClientAction | null {
  return isRecord(result) && result.refused === false && isRecord(result.action) ? (result.action as PlatformClientAction) : null
}

/** One line for the transcript's tool block; the full result stays in rawOutput. */
function resultText(result: unknown): string {
  if (!isRecord(result)) return JSON.stringify(result) ?? ''
  if (result.refused === true) return `Refused: ${String(result.reason)}`
  if (typeof result.summary === 'string') return result.summary
  return JSON.stringify(result)
}

const text = (content: string) => [{ type: 'content', content: { type: 'text', text: content } }]

export function createPlatformAgentRunner(deps: PlatformAgentDeps, options: PlatformAgentOptions = {}): NativeFamilyRunner {
  const flushIntervalMs = options.flushIntervalMs ?? 150
  return async ({ project, actor, thread, text: prompt, emit, signal }) => {
    const gateway = resolveLlmGatewayConfig(deps.db, deps.secretsReader)
    if (!gateway.baseUrl || !gateway.modelId || !gateway.apiKey) {
      emit({ kind: 'error', phase: 'start', message: 'The LLM gateway is not configured; set the gateway base URL, key and model id on the Settings page.', code: null })
      return
    }
    const accessed = new Map<string, CapabilityAccess>()
    const turn: PlatformTurnContext = {
      actor,
      project,
      capabilities: deps.capabilities,
      registry: loadRegistry(deps, actor, project),
      access(capabilityId) {
        let access = accessed.get(capabilityId)
        if (!access) accessed.set(capabilityId, access = resolveCapabilityAccess(deps, actor, project, capabilityId))
        return access
      },
      model: { baseUrl: gateway.baseUrl, modelId: gateway.modelId, apiKey: gateway.apiKey },
    }

    const output = await deps.mastra.getAgent(PLATFORM_AGENT_ID).stream(prompt, {
      requestContext: new RequestContext<PlatformRequestContext>([[PLATFORM_TURN_KEY, turn]]),
      memory: { thread: { id: thread.id, resourceId: actor.id }, resource: actor.id },
      abortSignal: signal,
      maxSteps: options.maxSteps ?? 6,
    })

    let pending = ''
    let flushedAt = Date.now()
    const flush = () => {
      if (!pending) return
      emit({ kind: 'text', role: 'agent', text: pending })
      pending = ''
      flushedAt = Date.now()
    }
    const record = (payload: AgentSessionEventPayload) => {
      flush()
      emit(payload)
    }

    for await (const chunk of output.fullStream) {
      switch (chunk.type) {
        case 'text-delta':
          pending += chunk.payload.text
          if (Date.now() - flushedAt >= flushIntervalMs) flush()
          break
        case 'tool-call': {
          const { toolCallId, toolName, args } = chunk.payload
          record({ kind: 'tool_call', toolCall: { toolCallId, title: TOOL_TITLES[toolName] ?? toolName, kind: 'other', status: 'in_progress', rawInput: args ?? {} } })
          break
        }
        case 'tool-result': {
          const { toolCallId, result } = chunk.payload
          record({ kind: 'tool_result', update: { toolCallId, status: 'completed', rawOutput: result, content: text(resultText(result)) } })
          const action = actionOf(result)
          if (action) record({ kind: 'client_action', toolCallId, action })
          break
        }
        case 'tool-error': {
          const { toolCallId, error } = chunk.payload
          record({ kind: 'tool_result', update: { toolCallId, status: 'failed', rawOutput: errorMessage(error), content: text(errorMessage(error)) } })
          break
        }
        case 'error':
          record({ kind: 'error', phase: 'prompt', message: errorMessage(chunk.payload.error), code: null })
          break
        default:
          break
      }
    }
    flush()
  }
}
