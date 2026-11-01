import { PLATFORM_AGENT_ID } from '@candy-mountain/shared'
import { bindService, defineCapabilityDefinition, serviceKey, type CapabilityDefinition } from '../capabilities/definition'
import type { DataPaths } from '../data-dir'
import { createMastra } from '../mastra'
import type { SessionFamily } from '../threads/families'
import { THREADS_CAPABILITY_ID } from '../threads/definition'
import { THREAD_SESSIONS, type ThreadSessions } from '../threads/sessions'
import type { NativeFamilyRunner } from '../threads/service'
import { createPlatformAgent } from './agent'
import { platformAgentCapability } from './manifest'
import { createPlatformAgentRunner, type PlatformAgentDeps, type PlatformAgentOptions } from './runner'

export const PLATFORM_FAMILY: SessionFamily = { id: 'platform', name: 'Platform agent' }

export interface PlatformAgentService {
  /** One turn of the platform chat family. */
  run: NativeFamilyRunner
  /** Cancels the turns still streaming, then shuts Mastra down. */
  close(): Promise<void>
}

export const PLATFORM_AGENT = serviceKey<PlatformAgentService>('platform-agent.service')

export interface PlatformAgentServiceDeps extends Omit<PlatformAgentDeps, 'mastra'> {
  paths: Pick<DataPaths, 'database'>
  sessions: Pick<ThreadSessions, 'cancel'>
}

export function startPlatformAgent({ paths, sessions, ...deps }: PlatformAgentServiceDeps, options: PlatformAgentOptions = {}): PlatformAgentService {
  // A definition starts synchronously while Mastra's store initialises on its own time, so the first turn waits for it; a failure
  // surfaces in that turn rather than as an unhandled rejection at boot.
  const ready = createMastra(paths, { agents: storage => ({ [PLATFORM_AGENT_ID]: createPlatformAgent({ storage }) }) })
  ready.catch(() => undefined)
  let runner: NativeFamilyRunner | undefined
  const running = new Set<string>()
  return {
    async run(turn) {
      running.add(turn.session.id)
      try {
        const { mastra } = await ready
        runner ??= createPlatformAgentRunner({ ...deps, mastra }, options)
        await runner(turn)
      }
      finally {
        running.delete(turn.session.id)
      }
    },
    async close() {
      await Promise.all([...running].map(id => sessions.cancel(id).catch(() => undefined)))
      const mastra = await ready.catch(() => undefined)
      await mastra?.close()
    },
  }
}

export function platformAgentDefinition(options: PlatformAgentOptions = {}): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: platformAgentCapability.id,
    manifest: platformAgentCapability,
    dependsOn: [THREADS_CAPABILITY_ID],
    sessionFamilies: [PLATFORM_FAMILY],
    provides: [PLATFORM_AGENT],
    start({ db, paths, secrets, capabilities, modules, pluginTypes, scopeUrlPrefix, scopeLabel, service }) {
      const agent = startPlatformAgent({ db, paths, capabilities, modules, pluginTypes, secrets: secrets.writeOnly, secretsReader: secrets, scopeUrlPrefix, scopeLabel, sessions: service(THREAD_SESSIONS) }, options)
      return {
        services: [bindService(PLATFORM_AGENT, agent)],
        chatFamilies: { [PLATFORM_FAMILY.id]: agent.run },
        close: () => agent.close(),
      }
    },
  })
}
