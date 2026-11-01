import { createAcpHarness, type AcpHarness, type AcpHarnessOptions } from '../acp'
import { bindService, defineCapabilityDefinition, serviceKey, type CapabilityDefinition, type CapabilityRuntime } from '../capabilities/definition'
import { createDecisionService, decisionRoutes, type DecisionService, type DecisionServiceOptions } from '../decisions'
import { claudeLoginAttempts } from '../plugins/claude-code/login-attempts'
import { claudeCodePluginType } from '../plugins/types/claude-code'
import { createSessionManager, sessionRoutes, type SessionManager, type SessionManagerOptions } from '../sessions'
import { THREADS_CAPABILITY_ID } from '../threads/definition'
import { THREAD_SESSIONS } from '../threads/sessions'
import { claudeCodeLauncher } from './launcher'
import { chatClaudeCodeCapability } from './manifest'

/** The ACP session service for dependents (chat-codex, bots) that declare `dependsOn: ['chat-claude-code']`; it runs over the platform's `THREAD_SESSIONS` store. */
export const ACP_SESSIONS = serviceKey<SessionManager>('acp.sessions')
export const ACP_HARNESS = serviceKey<AcpHarness>('acp.harness')
export const ACP_DECISIONS = serviceKey<DecisionService>('acp.decisions')

export const CLAUDE_CODE_FAMILY = { id: 'claude-code', name: 'Claude Code' } as const

export interface ChatClaudeCodeOptions {
  acp?: AcpHarnessOptions
  sessions?: SessionManagerOptions
  decisions?: DecisionServiceOptions
}

/** The routes alone, for an app that only needs them answered. */
export function chatClaudeCodeRoutes(sessions: SessionManager, decisions: DecisionService): Pick<CapabilityRuntime, 'workspaceRoutes'> {
  return { workspaceRoutes: [sessionRoutes(sessions), decisionRoutes(sessions, decisions)] }
}

export function chatClaudeCodeDefinition(options: ChatClaudeCodeOptions = {}): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: chatClaudeCodeCapability.id,
    manifest: chatClaudeCodeCapability,
    dependsOn: [THREADS_CAPABILITY_ID],
    pluginTypes: [claudeCodePluginType],
    sessionFamilies: [CLAUDE_CODE_FAMILY],
    provides: [ACP_SESSIONS, ACP_HARNESS, ACP_DECISIONS],
    start({ db, paths, secrets, pluginTypes, families, agentMcp, service }) {
      const harness = createAcpHarness(options.acp)
      const sessions = createSessionManager({ db, paths, pluginTypes, secrets: secrets.writeOnly, secretsReader: secrets, harness, store: service(THREAD_SESSIONS), families, mcpServers: session => agentMcp.serversFor(session) }, options.sessions)
      sessions.registerLauncher(CLAUDE_CODE_FAMILY.id, claudeCodeLauncher)
      const decisions = createDecisionService({ db, sessions }, options.decisions)
      return {
        services: [bindService(ACP_SESSIONS, sessions), bindService(ACP_HARNESS, harness), bindService(ACP_DECISIONS, decisions)],
        ...chatClaudeCodeRoutes(sessions, decisions),
        async close() {
          // Decisions stop first so a pending one stays pending in the log, as after a crash; the agents go after the rows they still write.
          decisions.close()
          await sessions.close()
          await harness.close()
          claudeLoginAttempts.close()
        },
      }
    },
  })
}
