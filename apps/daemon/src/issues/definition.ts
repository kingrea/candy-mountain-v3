import { assigneeRoutes } from '../assignees/routes'
import { bindService, defineCapabilityDefinition, serviceKey, type CapabilityDefinition, type CapabilityRuntime } from '../capabilities/definition'
import { issueEventRoutes } from './events-routes'
import { issuesCapability } from './manifest'
import { issueRoutes } from './routes'
import { startIssueWatcher, type IssueWatcher, type IssueWatcherOptions } from './watcher'
import { issueWriteRoutes } from './write-routes'

export const ISSUE_WATCHER = serviceKey<IssueWatcher>('issues.watcher')

export type IssuesOptions = Omit<IssueWatcherOptions, 'db'>

/** The routes without a watcher of their own; the event stream is served only when one is passed. */
export function issuesRoutes(watcher?: IssueWatcher): Pick<CapabilityRuntime, 'workspaceRoutes'> {
  // The event routes go first: the issue detail route `/:slug/issues/:id` would otherwise claim `events`.
  return { workspaceRoutes: [...(watcher ? [issueEventRoutes(watcher)] : []), issueRoutes(), issueWriteRoutes(), assigneeRoutes()] }
}

export function issuesDefinition(options: IssuesOptions = {}): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: issuesCapability.id,
    manifest: issuesCapability,
    provides: [ISSUE_WATCHER],
    start({ db }) {
      const watcher = startIssueWatcher({ ...options, db })
      return {
        services: [bindService(ISSUE_WATCHER, watcher)],
        ...issuesRoutes(watcher),
        close() {
          watcher.close()
        },
      }
    },
  })
}
