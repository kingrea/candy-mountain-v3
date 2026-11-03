import type { CreateWorkspaceRequest, Workspace } from '@candy-mountain/shared'
import type { Db } from '../db'
import { createWorkspace } from '../workspaces/workspaces'
import { setRepository } from './service'

export interface CreateWorkspaceWithRepositoryInput extends CreateWorkspaceRequest {
  /** An existing directory; the repository is checked as the routes would. */
  path: string
}

/** A workspace with its repository set, for tests of the capabilities that run in a checkout. */
export async function createWorkspaceWithRepository(db: Db, { path, ...input }: CreateWorkspaceWithRepositoryInput): Promise<Workspace> {
  const workspace = createWorkspace(db, input)
  await setRepository(db, workspace.id, { kind: 'local-path', path })
  return workspace
}
