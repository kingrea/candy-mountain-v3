import { randomUUID } from 'node:crypto'
import type { ModuleId } from '@candy-mountain/shared'
import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { projectModules } from '../db/schema'
import type { ModuleRegistry } from '../modules'
import { ProjectModulesError } from './errors'

/**
 * In registry order when given the registry, which also drops rows of modules the product no longer registers;
 * by id otherwise. Either way the answer does not depend on insertion order.
 */
export function listEnabledModules(db: Db, projectId: string, modules?: Pick<ModuleRegistry, 'list'>): ModuleId[] {
  const enabled = db.select({ moduleId: projectModules.moduleId }).from(projectModules).where(eq(projectModules.projectId, projectId)).orderBy(asc(projectModules.moduleId)).all().map(row => row.moduleId)
  if (!modules) return enabled
  const wanted = new Set(enabled)
  return modules.list().map(mod => mod.id).filter(id => wanted.has(id))
}

export function setEnabledModules(db: Db, projectId: string, moduleIds: readonly ModuleId[], modules?: Pick<ModuleRegistry, 'list'>): ModuleId[] {
  const wanted = new Set(moduleIds)
  const now = new Date().toISOString()
  db.transaction((tx) => {
    const current = new Set(tx.select({ moduleId: projectModules.moduleId }).from(projectModules).where(eq(projectModules.projectId, projectId)).all().map(row => row.moduleId))
    for (const id of current) {
      if (!wanted.has(id)) tx.delete(projectModules).where(and(eq(projectModules.projectId, projectId), eq(projectModules.moduleId, id))).run()
    }
    for (const id of wanted) {
      if (!current.has(id)) tx.insert(projectModules).values({ id: randomUUID(), projectId, moduleId: id, createdAt: now, updatedAt: now }).run()
    }
  })
  return listEnabledModules(db, projectId, modules)
}

export function parseModuleIds(body: unknown, modules: ModuleRegistry): ModuleId[] {
  const list = (body as { modules?: unknown } | null)?.modules
  if (!Array.isArray(list) || list.some(id => typeof id !== 'string')) {
    throw new ProjectModulesError('invalid_request', 'Body must be { modules: string[] }')
  }
  const unknown = list.filter(id => !modules.has(id))
  if (unknown.length > 0) throw new ProjectModulesError('module_not_found', `Unknown module: ${unknown.join(', ')}`)
  return list
}
