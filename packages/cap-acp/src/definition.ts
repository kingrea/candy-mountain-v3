import { REPOSITORY_CAPABILITY_ID, REPOSITORY_PATHS } from '@candy-mountain/plugin-repository'
import { bindService, defineCapabilityDefinition, serviceKey, type CapabilityDefinition, type CapabilityRuntime } from '@crab-shack/platform-sdk/daemon'
import { THREAD_SESSIONS, THREADS_CAPABILITY_ID } from '@crab-shack/platform-daemon'
import { createAcpHarness, type AcpHarness, type AcpHarnessOptions } from './acp'
import { createDecisionService, decisionRoutes, resolveDecisionSettings, type DecisionService, type DecisionServiceOptions } from './decisions'
import { createSessionManager, resolveSessionSettings, sessionRoutes, type SessionManager, type SessionManagerOptions } from './sessions'

export const ACP_CAPABILITY_ID = 'acp'

/** The ACP session service for dependents that declare `dependsOn: ['acp']`; it runs over the platform's `THREAD_SESSIONS` store. */
export const ACP_SESSIONS = serviceKey<SessionManager>('acp.sessions')
export const ACP_HARNESS = serviceKey<AcpHarness>('acp.harness')
export const ACP_DECISIONS = serviceKey<DecisionService>('acp.decisions')

export interface AcpOptions {
  acp?: AcpHarnessOptions
  sessions?: SessionManagerOptions
  decisions?: DecisionServiceOptions
}

/** The routes alone, for an app that only needs them answered. */
export function acpRoutes(sessions: SessionManager, decisions: DecisionService): Pick<CapabilityRuntime, 'workspaceRoutes'> {
  return { workspaceRoutes: [sessionRoutes(sessions), decisionRoutes(sessions, decisions)] }
}

export function acpDefinition(options: AcpOptions = {}): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: ACP_CAPABILITY_ID,
    dependsOn: [THREADS_CAPABILITY_ID, REPOSITORY_CAPABILITY_ID],
    provides: [ACP_SESSIONS, ACP_HARNESS, ACP_DECISIONS],
    start({ db, paths, secrets, pluginTypes, families, agentMcp, service }) {
      const harness = createAcpHarness(options.acp)
      const repository = service(REPOSITORY_PATHS)
      const sessions = createSessionManager({ db, paths, pluginTypes, secrets: secrets.writeOnly, secretsReader: secrets, harness, store: service(THREAD_SESSIONS), families, mcpServers: session => agentMcp.serversFor(session), workingDirectory: repository.find }, { ...resolveSessionSettings(), ...options.sessions })
      const decisions = createDecisionService({ db, sessions }, { ...resolveDecisionSettings(), ...options.decisions })
      return {
        services: [bindService(ACP_SESSIONS, sessions), bindService(ACP_HARNESS, harness), bindService(ACP_DECISIONS, decisions)],
        ...acpRoutes(sessions, decisions),
        async close() {
          // Decisions stop first so a pending one stays pending in the log, as after a crash; the agents go after the rows they still write.
          decisions.close()
          await sessions.close()
          await harness.close()
        },
      }
    },
  })
}
