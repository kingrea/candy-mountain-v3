import type { Repository, RepositorySource, RepositoryVerification } from '@candy-mountain/platform-sdk'
import { eq } from 'drizzle-orm'
import type { Db } from '@candy-mountain/platform-daemon'
import { repositories } from './schema'
import { RepositoryError } from './errors'
import { normaliseRepositoryPath, requireExistingDirectory, verifyPath } from './verification'

type RepositoryRow = typeof repositories.$inferSelect

/** What the repository definition provides to dependents: where a workspace's checkout is. */
export interface RepositoryPaths {
  /** The absolute checkout of the workspace's repository, or null when it has none. */
  find(workspaceId: string): string | null
  /** Throws a not_found RepositoryError for a workspace without a repository. */
  get(workspaceId: string): string
}

const toRepository = (row: RepositoryRow): Repository => ({
  workspaceId: row.workspaceId,
  source: row.source,
  verification: row.verification,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const sourcePath = (source: RepositorySource): string => source.path

export function findRepository(db: Db, workspaceId: string): Repository | null {
  const row = db.select().from(repositories).where(eq(repositories.workspaceId, workspaceId)).get()
  return row ? toRepository(row) : null
}

export function getRepository(db: Db, workspaceId: string): Repository {
  const repository = findRepository(db, workspaceId)
  if (!repository) throw new RepositoryError('not_found', `Workspace ${workspaceId} has no repository`)
  return repository
}

export async function checkRepositoryPath(path: string): Promise<RepositoryVerification> {
  return verifyPath(normaliseRepositoryPath(path))
}

/** Replaces the workspace's repository; the path must exist, and its facts are checked before the write. */
export async function setRepository(db: Db, workspaceId: string, source: RepositorySource): Promise<Repository> {
  const path = normaliseRepositoryPath(source.path)
  await requireExistingDirectory(path)
  const prepared: RepositorySource = { kind: source.kind, path }
  const verification = await verifyPath(path)

  // Read after the awaits so no other request can interleave between the check and the write.
  const now = new Date().toISOString()
  const existing = findRepository(db, workspaceId)
  const row: RepositoryRow = { workspaceId, source: prepared, verification, createdAt: existing?.createdAt ?? now, updatedAt: now }
  db.insert(repositories).values(row).onConflictDoUpdate({ target: repositories.workspaceId, set: { source: prepared, verification, updatedAt: now } }).run()
  return toRepository(row)
}

/** Re-runs the check; a vanished path is recorded, not an error. */
export async function reverifyRepository(db: Db, workspaceId: string): Promise<Repository> {
  const existing = getRepository(db, workspaceId)
  const verification = await verifyPath(sourcePath(existing.source))
  const updatedAt = new Date().toISOString()
  db.update(repositories).set({ verification, updatedAt }).where(eq(repositories.workspaceId, workspaceId)).run()
  return { ...existing, verification, updatedAt }
}

export function repositoryPaths(db: Db): RepositoryPaths {
  const find = (workspaceId: string): string | null => {
    const row = db.select({ source: repositories.source }).from(repositories).where(eq(repositories.workspaceId, workspaceId)).get()
    return row ? sourcePath(row.source) : null
  }
  return {
    find,
    get(workspaceId) {
      const path = find(workspaceId)
      if (path === null) throw new RepositoryError('not_found', `Workspace ${workspaceId} has no repository`)
      return path
    },
  }
}
