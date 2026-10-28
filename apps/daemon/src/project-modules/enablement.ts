import { randomUUID } from 'node:crypto'
import { MODULE_IDS, type ModuleId } from '@candy-mountain/shared'
import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { projectModules } from '../db/schema'
import type { ModuleRegistry } from '../modules'
import { ProjectModulesError } from './errors'

/** Returned in registry order so the answer does not depend on insertion order. */
export function listEnabledModules(db: Db, projectId: string): ModuleId[] {
  const enabled = new Set(db.select({ moduleId: projectModules.moduleId }).from(projectModules).where(eq(projectModules.projectId, projectId)).orderBy(asc(projectModules.moduleId)).all().map(row => row.moduleId))
  return MODULE_IDS.filter(id => enabled.has(id))
}

export function setEnabledModules(db: Db, projectId: string, moduleIds: readonly ModuleId[]): ModuleId[] {
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
  return listEnabledModules(db, projectId)
}

export function parseModuleIds(body: unknown, modules: ModuleRegistry): ModuleId[] {
  const list = (body as { modules?: unknown } | null)?.modules
  if (!Array.isArray(list) || list.some(id => typeof id !== 'string')) {
    throw new ProjectModulesError('invalid_request', 'Body must be { modules: string[] }')
  }
  const unknown = list.filter(id => !modules.has(id as ModuleId))
  if (unknown.length > 0) throw new ProjectModulesError('module_not_found', `Unknown module: ${unknown.join(', ')}`)
  return list as ModuleId[]
}
