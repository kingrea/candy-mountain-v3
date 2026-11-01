import { bindService, defineCapabilityDefinition, type CapabilityDefinition } from '../capabilities/definition'
import { createSessionStore, THREAD_SESSIONS, type SessionStoreOptions } from './sessions'

export const THREADS_CAPABILITY_ID = 'threads'

export interface ThreadsOptions {
  sessions?: SessionStoreOptions
}

/** The platform's own: the session store every chat family's rows go through, started ahead of the product's definitions, which reach it by `dependsOn`. */
export function threadsDefinition(options: ThreadsOptions = {}): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: THREADS_CAPABILITY_ID,
    provides: [THREAD_SESSIONS],
    start({ db, families }) {
      const sessions = createSessionStore({ db, families }, options.sessions)
      return {
        services: [bindService(THREAD_SESSIONS, sessions)],
        close: () => sessions.close(),
      }
    },
  })
}
