import { bindService, defineCapabilityDefinition, type ActivityEventTypeDeclaration, type CapabilityDefinition } from '@candy-mountain/platform-sdk/daemon'
import { createSessionStore, THREAD_SESSIONS, type SessionStoreOptions } from './sessions'

export const THREADS_CAPABILITY_ID = 'threads'

/** Appended by the session store and the thread service, for every product. */
export const THREAD_ACTIVITY_EVENT_TYPES: readonly ActivityEventTypeDeclaration[] = [
  { id: 'session.started', label: 'Session started', icon: 'i-lucide-message-square' },
  { id: 'run.started', label: 'Run started', icon: 'i-lucide-play' },
]

export interface ThreadsOptions {
  sessions?: SessionStoreOptions
}

/** The platform's own: the session store every chat family's rows go through, started ahead of the product's definitions, which reach it by `dependsOn`. */
export function threadsDefinition(options: ThreadsOptions = {}): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: THREADS_CAPABILITY_ID,
    provides: [THREAD_SESSIONS],
    activityEventTypes: THREAD_ACTIVITY_EVENT_TYPES,
    start({ db, families }) {
      const sessions = createSessionStore({ db, families }, options.sessions)
      return {
        services: [bindService(THREAD_SESSIONS, sessions)],
        close: () => sessions.close(),
      }
    },
  })
}
