import { randomUUID } from 'node:crypto'
import type { ModuleId } from '@candy-mountain/platform-sdk'
import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { workspaceModules } from '../db/schema'
import type { ModuleRegistry } from '../modules'
import { WorkspaceModulesError } from './errors'

/**
 * In registry order when given the registry, which also drops rows of modules the product no longer registers;
 * by id otherwise. Either way the answer does not depend on insertion order.
 */
export function listEnabledModules(db: Db, workspaceId: string, modules?: Pick<ModuleRegistry, 'list'>): ModuleId[] {
  const enabled = db.select({ moduleId: workspaceModules.moduleId }).from(workspaceModules).where(eq(workspaceModules.workspaceId, workspaceId)).orderBy(asc(workspaceModules.moduleId)).all().map(row => row.moduleId)
  if (!modules) return enabled
  const wanted = new Set(enabled)
  return modules.list().map(mod => mod.id).filter(id => wanted.has(id))
}

export function setEnabledModules(db: Db, workspaceId: string, moduleIds: readonly ModuleId[], modules?: Pick<ModuleRegistry, 'list'>): ModuleId[] {
  const wanted = new Set(moduleIds)
  const now = new Date().toISOString()
  db.transaction((tx) => {
    const current = new Set(tx.select({ moduleId: workspaceModules.moduleId }).from(workspaceModules).where(eq(workspaceModules.workspaceId, workspaceId)).all().map(row => row.moduleId))
    for (const id of current) {
      if (!wanted.has(id)) tx.delete(workspaceModules).where(and(eq(workspaceModules.workspaceId, workspaceId), eq(workspaceModules.moduleId, id))).run()
    }
    for (const id of wanted) {
      if (!current.has(id)) tx.insert(workspaceModules).values({ id: randomUUID(), workspaceId, moduleId: id, createdAt: now, updatedAt: now }).run()
    }
  })
  return listEnabledModules(db, workspaceId, modules)
}

export function parseModuleIds(body: unknown, modules: ModuleRegistry): ModuleId[] {
  const list = (body as { modules?: unknown } | null)?.modules
  if (!Array.isArray(list) || list.some(id => typeof id !== 'string')) {
    throw new WorkspaceModulesError('invalid_request', 'Body must be { modules: string[] }')
  }
  const unknown = list.filter(id => !modules.has(id))
  if (unknown.length > 0) throw new WorkspaceModulesError('module_not_found', `Unknown module: ${unknown.join(', ')}`)
  return list
}
