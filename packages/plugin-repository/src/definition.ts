import type { Workspace } from '@crab-shack/platform-sdk'
import { REPOSITORY_CAPABILITY_ID, type RepositoryVerification } from './wire'
import { bindService, defineCapabilityDefinition, serviceKey, type CapabilityDefinition, type WorkspaceFactDeclaration } from '@crab-shack/platform-sdk/daemon'
import type { Db } from '@crab-shack/platform-daemon'
import { repositoryPluginType } from './plugin-type/definition'
import { repositoryRoutes } from './routes'
import { findRepository, repositoryPaths, type RepositoryPaths } from './service'
import { srcPath } from './package-root'
import * as repositorySchema from './schema'

/** A workspace's checkout, for dependents that declare `dependsOn: ['repository']`: issues runs bd there, chat sessions start there, bots branch worktrees off it. */
export const REPOSITORY_PATHS = serviceKey<RepositoryPaths>('repository.paths')

const verified = (db: Db, workspace: Pick<Workspace, 'id'>): RepositoryVerification | undefined => findRepository(db, workspace.id)?.verification

/** The stored verification facts; a workspace without a repository has none of them. */
export const REPOSITORY_WORKSPACE_FACTS: readonly WorkspaceFactDeclaration[] = [
  { id: 'hasBeads', compute: (db, workspace) => verified(db, workspace)?.hasBeads ?? false, message: label => `The ${label.singular} has no .beads directory.` },
  { id: 'isGitRepo', compute: (db, workspace) => verified(db, workspace)?.isGitRepo ?? false, message: label => `The ${label.singular} is not a git repository.` },
  { id: 'hasRemote', compute: (db, workspace) => verified(db, workspace)?.hasRemote ?? false, message: label => `The ${label.singular} has no git remote.` },
]

/** Service-only: no manifest, so no views, no ladder, and nothing in the catalog, modules or grants. It brings the repository plugin type, which no capability with views owns. */
export function repositoryDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: REPOSITORY_CAPABILITY_ID,
    schema: { schema: repositorySchema, migrationsFolder: srcPath('migrations') },
    provides: [REPOSITORY_PATHS],
    pluginTypes: [repositoryPluginType],
    workspaceFacts: REPOSITORY_WORKSPACE_FACTS,
    start({ db }) {
      return {
        services: [bindService(REPOSITORY_PATHS, repositoryPaths(db))],
        workspaceRoutes: [repositoryRoutes()],
      }
    },
  })
}
