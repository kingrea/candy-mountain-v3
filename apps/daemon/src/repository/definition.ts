import { REPOSITORY_CAPABILITY_ID, type RepositoryVerification, type Workspace } from '@candy-mountain/platform-sdk'
import { bindService, defineCapabilityDefinition, serviceKey, type CapabilityDefinition, type WorkspaceFactDeclaration } from '@candy-mountain/platform-sdk/daemon'
import type { Db } from '@candy-mountain/platform-daemon'
import { repositoryRoutes } from './routes'
import { findRepository, repositoryPaths, type RepositoryPaths } from './service'
import { srcPath } from '../package-root'
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

/** Service-only: no manifest, so no views, no ladder, and nothing in the catalog, modules or grants. */
export function repositoryDefinition(): CapabilityDefinition {
  return defineCapabilityDefinition({
    id: REPOSITORY_CAPABILITY_ID,
    schema: { schema: repositorySchema, migrationsFolder: srcPath('repository', 'migrations') },
    provides: [REPOSITORY_PATHS],
    workspaceFacts: REPOSITORY_WORKSPACE_FACTS,
    start({ db }) {
      return {
        services: [bindService(REPOSITORY_PATHS, repositoryPaths(db))],
        workspaceRoutes: [repositoryRoutes()],
      }
    },
  })
}
