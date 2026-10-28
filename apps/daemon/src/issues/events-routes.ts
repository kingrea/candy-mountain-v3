import { ISSUE_CHANGED_EVENT, type ApiErrorBody, type IssueChangedEvent } from '@candy-mountain/shared'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { AppEnv } from '../app'
import { getProjectBySlug, ProjectError } from '../projects'
import type { IssueWatcher } from './watcher'

// Node fetch (the web proxy) drops a response body that stays silent for 300s.
export const ISSUE_EVENTS_HEARTBEAT_MS = 30_000

export interface IssueEventRoutesOptions {
  heartbeatMs?: number
}

function onProjectError(error: Error, c: Context) {
  if (error instanceof ProjectError) {
    return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
  }
  throw error
}

/** Mounted at PROJECTS_PATH ahead of issueRoutes, whose `/:slug/issues/:id` would otherwise claim `events`. */
export function issueEventRoutes(watcher: IssueWatcher, options: IssueEventRoutesOptions = {}) {
  const heartbeatMs = options.heartbeatMs ?? ISSUE_EVENTS_HEARTBEAT_MS
  const app = new Hono<AppEnv>()
  app.onError(onProjectError)

  app.get('/:slug/issues/events', (c) => {
    const project = getProjectBySlug(c.var.db, c.req.param('slug'))
    const data = JSON.stringify({ projectId: project.id } satisfies IssueChangedEvent)

    return streamSSE(c, async (stream) => {
      if (watcher.signal.aborted) return
      const done = new Promise<void>((resolve) => {
        stream.onAbort(resolve)
        watcher.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      const unsubscribe = watcher.subscribe(project.id, () => {
        void stream.writeSSE({ event: ISSUE_CHANGED_EVENT, data })
      })
      const heartbeat = setInterval(() => void stream.write(': ping\n\n'), heartbeatMs)
      try {
        // Response headers only leave Node with the first body bytes, so open the stream straight away.
        await stream.write(': connected\n\n')
        await done
      }
      finally {
        clearInterval(heartbeat)
        unsubscribe()
      }
    })
  })

  return app
}
