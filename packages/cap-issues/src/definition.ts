import { REPOSITORY_CAPABILITY_ID, REPOSITORY_PATHS, type RepositoryPaths } from '@candy-mountain/plugin-repository'
import { bindService, defineCapabilityDefinition, serviceKey, type CapabilityDefinition, type CapabilityRuntime } from '@crab-shack/platform-sdk/daemon'
import { assigneeRoutes } from './assignees/routes'
import { issueEventRoutes } from './events-routes'
import { issuesCapability } from './manifest'
import { issueRoutes } from './routes'
import { startIssueWatcher, type IssueWatcher, type IssueWatcherOptions } from './watcher'
import { issueWriteRoutes } from './write-routes'
import { srcPath } from './package-root'
import * as issuesSchema from './schema'

export const ISSUE_WATCHER = serviceKey<IssueWatcher>('issues.watcher')

export type IssuesOptions = Omit<IssueWatcherOptions, 'db' | 'repository'>

/** The routes without a watcher of their own; the event stream is served only when one is passed. */
export function issuesRoutes(repository: RepositoryPaths, watcher?: IssueWatcher): Pick<CapabilityRuntime, 'workspaceRoutes'> {
  // The event routes go first: the issue detail route `/:slug/issues/:id` would otherwise claim `events`.
  return { workspaceRoutes: [...(watcher ? [issueEventRoutes(watcher)] : []), issueRoutes(repository), issueWriteRoutes(repository), assigneeRoutes()] }
}

export function issuesDefinition(options: IssuesOptions = {}): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: issuesCapability.id,
    package: '@candy-mountain/cap-issues',
    sdkMajor: 0,
    manifest: issuesCapability,
    schema: { schema: issuesSchema, migrationsFolder: srcPath('migrations') },
    dependsOn: [REPOSITORY_CAPABILITY_ID],
    provides: [ISSUE_WATCHER],
    start({ db, service }) {
      const repository = service(REPOSITORY_PATHS)
      const watcher = startIssueWatcher({ ...options, db, repository })
      return {
        services: [bindService(ISSUE_WATCHER, watcher)],
        ...issuesRoutes(repository, watcher),
        close() {
          watcher.close()
        },
      }
    },
  })
}
