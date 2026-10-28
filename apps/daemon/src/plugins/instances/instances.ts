import { randomUUID } from 'node:crypto'
import {
  validatePluginConfig,
  type PluginConfig,
  type PluginConfigError,
  type PluginHealth,
  type PluginInstance,
  type PluginInstanceHealth,
  type PluginScope,
  type PluginSecretValues,
  type PluginTypeId,
} from '@candy-mountain/shared'
import { and, eq, isNull, or } from 'drizzle-orm'
import type { DataPaths } from '../../data-dir'
import type { Db } from '../../db'
import { pluginInstances, projects } from '../../db/schema'
import { findProjectById } from '../../projects/projects'
import type { SecretsStore, SecretsWriter } from '../../secrets'
import type { AnyPluginType } from '../definition'
import { checkPluginHealth } from '../health'
import type { PluginTypeRegistry } from '../registry'
import { createPluginSecrets, pluginSecretOwner } from '../secrets'
import { PluginInstanceError } from './errors'

/** `c.var` and `Platform` both satisfy this. */
export interface PluginInstanceDeps {
  db: Db
  pluginTypes: PluginTypeRegistry
  secrets: SecretsWriter
}

export type SecretsReader = Pick<SecretsStore, 'get'>

export interface CreatePluginInstanceInput {
  type: string
  scope: PluginScope
  projectId: string | null
  config?: unknown
  secrets?: PluginSecretValues
}

export interface UpdatePluginInstanceInput {
  config?: Record<string, unknown>
  secrets?: PluginSecretValues
}

type InstanceRow = typeof pluginInstances.$inferSelect

const selectInstances = (db: Db) =>
  db.select({ row: pluginInstances, projectSlug: projects.slug }).from(pluginInstances).leftJoin(projects, eq(projects.id, pluginInstances.projectId))

function toInstance(deps: PluginInstanceDeps, row: InstanceRow, projectSlug: string | null): PluginInstance {
  const type = deps.pluginTypes.byId(row.typeId)
  const owner = pluginSecretOwner(row.id)
  return {
    id: row.id,
    type: row.typeId as PluginTypeId,
    scope: row.scope,
    projectId: row.projectId,
    projectSlug,
    config: row.config,
    secrets: Object.fromEntries((type?.secretFields ?? []).map(f => [f.name, deps.secrets.isSet(owner, f.name) ? 'set' : 'unset'])),
    health: row.health && row.healthCheckedAt ? { ...row.health, checkedAt: row.healthCheckedAt } : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function sortInstances(deps: PluginInstanceDeps, rows: { row: InstanceRow, projectSlug: string | null }[]): PluginInstance[] {
  const typeOrder = deps.pluginTypes.ids() as readonly string[]
  const rank = (row: InstanceRow) => [row.scope === 'project' ? 0 : 1, typeOrder.includes(row.typeId) ? typeOrder.indexOf(row.typeId) : typeOrder.length] as const
  return rows
    .sort((a, b) => {
      const [sa, ta] = rank(a.row)
      const [sb, tb] = rank(b.row)
      return sa - sb || ta - tb || a.row.createdAt.localeCompare(b.row.createdAt)
    })
    .map(({ row, projectSlug }) => toInstance(deps, row, projectSlug))
}

/** With a project: its own instances first, then the global ones. Without: global instances only. */
export function listPluginInstances(deps: PluginInstanceDeps, { projectId }: { projectId?: string } = {}): PluginInstance[] {
  const global = eq(pluginInstances.scope, 'global')
  const where = projectId === undefined ? global : or(global, eq(pluginInstances.projectId, projectId))
  return sortInstances(deps, selectInstances(deps.db).where(where).all())
}

export function findPluginInstance(deps: PluginInstanceDeps, id: string): PluginInstance | null {
  const found = selectInstances(deps.db).where(eq(pluginInstances.id, id)).get()
  return found ? toInstance(deps, found.row, found.projectSlug) : null
}

export function getPluginInstance(deps: PluginInstanceDeps, id: string): PluginInstance {
  const instance = findPluginInstance(deps, id)
  if (!instance) throw new PluginInstanceError('not_found', `No plugin instance with id "${id}"`)
  return instance
}

/**
 * The instance a project uses for a plugin type: its own, else the platform's global one.
 * Oldest first when a multi-instance type has several.
 */
export function resolvePluginInstance(deps: PluginInstanceDeps, projectId: string, typeId: PluginTypeId): PluginInstance | null {
  return listPluginInstances(deps, { projectId }).find(i => i.type === typeId) ?? null
}

export function pluginTypeOf(deps: Pick<PluginInstanceDeps, 'pluginTypes'>, typeId: string): AnyPluginType {
  const type = deps.pluginTypes.byId(typeId)
  if (!type) throw new PluginInstanceError('type_not_found', `Plugin type "${typeId}" is not registered`)
  return type
}

const describeErrors = (errors: PluginConfigError[]) => errors.map(e => (e.field ? `${e.field}: ${e.message}` : e.message)).join(' ')

function validateConfig(type: AnyPluginType, input: unknown): PluginConfig {
  const result = validatePluginConfig(type.configFields, input)
  if (!result.ok) throw new PluginInstanceError('invalid_config', describeErrors(result.errors))
  return result.config
}

/** The stored config, re-checked because a type's fields can change between releases. */
export function instanceConfig(type: AnyPluginType, instance: Pick<PluginInstance, 'config'>): PluginConfig {
  const result = validatePluginConfig(type.configFields, instance.config)
  if (!result.ok) throw new PluginInstanceError('invalid_config', `The saved config is no longer valid: ${describeErrors(result.errors)}`)
  return result.config
}

interface SecretChanges {
  set: [name: string, value: string][]
  clear: string[]
}

function secretChanges(type: AnyPluginType, input: PluginSecretValues | undefined, creating: boolean): SecretChanges {
  const values = input ?? {}
  const unknown = Object.keys(values).filter(name => !type.secretFields.some(f => f.name === name))
  if (unknown.length) throw new PluginInstanceError('invalid_secrets', `${type.name} has no secret field(s) ${unknown.join(', ')}`)
  const changes: SecretChanges = { set: [], clear: [] }
  for (const field of type.secretFields) {
    const value = values[field.name]
    if (typeof value === 'string' && value !== '') changes.set.push([field.name, value])
    else if (value === null && !creating) {
      if (field.required) throw new PluginInstanceError('invalid_secrets', `${field.label} is required and cannot be cleared`)
      changes.clear.push(field.name)
    }
    else if (creating && field.required) {
      throw new PluginInstanceError('invalid_secrets', `${field.label} is required`)
    }
  }
  return changes
}

function assertCanWrite(deps: PluginInstanceDeps, changes: SecretChanges) {
  if (changes.set.length && !deps.secrets.unlocked) {
    throw new PluginInstanceError('secrets_locked', 'Secrets are locked because CM_SECRETS_KEY is not set, so secret values cannot be saved')
  }
}

function applySecrets(deps: PluginInstanceDeps, id: string, changes: SecretChanges) {
  const owner = pluginSecretOwner(id)
  for (const [name, value] of changes.set) deps.secrets.set(owner, name, value)
  for (const name of changes.clear) deps.secrets.delete(owner, name)
}

function ownerTaken(db: Db, typeId: string, projectId: string | null): boolean {
  const owner = projectId === null ? isNull(pluginInstances.projectId) : eq(pluginInstances.projectId, projectId)
  return db.select({ id: pluginInstances.id }).from(pluginInstances).where(and(eq(pluginInstances.typeId, typeId), owner)).get() !== undefined
}

export function createPluginInstance(deps: PluginInstanceDeps, input: CreatePluginInstanceInput): PluginInstance {
  const type = pluginTypeOf(deps, input.type)
  if (!type.scopes.includes(input.scope)) {
    throw new PluginInstanceError('unsupported_scope', `${type.name} supports ${type.scopes.join(' and ')} scope only, not ${input.scope}`)
  }
  if ((input.scope === 'project') !== (input.projectId !== null)) {
    throw new PluginInstanceError('invalid_request', input.scope === 'project' ? 'A project instance needs a project' : 'A global instance cannot belong to a project')
  }
  if (input.projectId !== null && !findProjectById(deps.db, input.projectId)) {
    throw new PluginInstanceError('project_not_found', `No project with id "${input.projectId}"`)
  }
  const config = validateConfig(type, input.config ?? {})
  const changes = secretChanges(type, input.secrets, true)
  assertCanWrite(deps, changes)

  const id = randomUUID()
  const now = new Date().toISOString()
  deps.db.transaction((tx) => {
    if (type.singleInstance && ownerTaken(tx, type.id, input.projectId)) {
      throw new PluginInstanceError('instance_exists', `${input.projectId === null ? 'The platform' : 'This project'} already has a ${type.name} instance`)
    }
    tx.insert(pluginInstances).values({ id, typeId: type.id, scope: input.scope, projectId: input.projectId, config, createdAt: now, updatedAt: now }).run()
  })
  try {
    applySecrets(deps, id, changes)
  }
  catch (error) {
    deps.db.delete(pluginInstances).where(eq(pluginInstances.id, id)).run()
    deps.secrets.deleteOwner(pluginSecretOwner(id))
    throw error
  }
  return getPluginInstance(deps, id)
}

/** Any change clears the stored health, since it no longer describes the instance. */
export function updatePluginInstance(deps: PluginInstanceDeps, id: string, input: UpdatePluginInstanceInput): PluginInstance {
  const existing = getPluginInstance(deps, id)
  const type = pluginTypeOf(deps, existing.type)
  const config = input.config === undefined ? existing.config : validateConfig(type, { ...existing.config, ...input.config })
  const changes = secretChanges(type, input.secrets, false)
  assertCanWrite(deps, changes)

  const configChanged = JSON.stringify(config) !== JSON.stringify(existing.config)
  const secretsChanged = changes.set.length > 0 || changes.clear.some(name => existing.secrets[name] === 'set')
  if (!configChanged && !secretsChanged) return existing

  applySecrets(deps, id, changes)
  deps.db.update(pluginInstances)
    .set({ config, health: null, healthCheckedAt: null, updatedAt: new Date().toISOString() })
    .where(eq(pluginInstances.id, id))
    .run()
  return getPluginInstance(deps, id)
}

export type PluginInstanceDeleteDeps = PluginInstanceDeps & { secretsReader: SecretsReader, paths: DataPaths }

async function runDeleteHook(deps: PluginInstanceDeleteDeps, instance: PluginInstance): Promise<void> {
  const type = deps.pluginTypes.byId(instance.type)
  await type?.onDelete?.({ instance, paths: deps.paths, secrets: createPluginSecrets(deps.secretsReader, instance.id, type) })
}

export async function deletePluginInstance(deps: PluginInstanceDeleteDeps, id: string): Promise<void> {
  await runDeleteHook(deps, getPluginInstance(deps, id))
  const removed = deps.db.delete(pluginInstances).where(eq(pluginInstances.id, id)).run()
  if (removed.changes === 0) throw new PluginInstanceError('not_found', `No plugin instance with id "${id}"`)
  deps.secrets.deleteOwner(pluginSecretOwner(id))
}

/** Call before deleting a project: the rows would cascade, but their secrets and agent homes live outside the database. */
export async function deleteProjectPluginInstances(deps: PluginInstanceDeleteDeps, projectId: string): Promise<number> {
  const instances = selectInstances(deps.db).where(eq(pluginInstances.projectId, projectId)).all().map(({ row, projectSlug }) => toInstance(deps, row, projectSlug))
  for (const instance of instances) await runDeleteHook(deps, instance)
  deps.db.delete(pluginInstances).where(eq(pluginInstances.projectId, projectId)).run()
  for (const { id } of instances) deps.secrets.deleteOwner(pluginSecretOwner(id))
  return instances.length
}

export interface TestPluginInstanceOptions {
  timeoutMs?: number
}

/** Runs the type's health check and stores the result; never throws for a failing check. */
export async function testPluginInstance(deps: PluginInstanceDeps & { secretsReader: SecretsReader, paths?: DataPaths }, id: string, { timeoutMs }: TestPluginInstanceOptions = {}): Promise<PluginInstance> {
  const instance = getPluginInstance(deps, id)
  const type = pluginTypeOf(deps, instance.type)
  let health: PluginHealth
  try {
    const config = instanceConfig(type, instance)
    const { id: instanceId, scope, projectId } = instance
    health = await checkPluginHealth(type, { config, secrets: createPluginSecrets(deps.secretsReader, id, type), timeoutMs, instance: { id: instanceId, scope, projectId }, paths: deps.paths })
  }
  catch (error) {
    if (!(error instanceof PluginInstanceError)) throw error
    health = { healthy: false, reason: error.message }
  }

  // Guarded on updatedAt so a result for config that changed mid-check is never stored against the new config.
  const stored = deps.db.update(pluginInstances)
    .set({ health, healthCheckedAt: new Date().toISOString() })
    .where(and(eq(pluginInstances.id, id), eq(pluginInstances.updatedAt, instance.updatedAt)))
    .run()
  if (stored.changes === 0) {
    getPluginInstance(deps, id)
    throw new PluginInstanceError('instance_changed', 'The instance changed while it was being tested; test it again')
  }
  return getPluginInstance(deps, id)
}

type TestPluginInstanceDeps = Parameters<typeof testPluginInstance>[0]

/** testPluginInstance for callers that cannot act on a conflict: null when the instance changed or vanished mid-check, so nothing was stored. */
export async function refreshPluginInstanceHealth(deps: TestPluginInstanceDeps, id: string): Promise<PluginInstanceHealth | null> {
  try {
    return (await testPluginInstance(deps, id)).health
  }
  catch (error) {
    if (error instanceof PluginInstanceError && (error.code === 'instance_changed' || error.code === 'not_found')) return null
    throw error
  }
}

export function resetPluginInstanceHealth(deps: Pick<PluginInstanceDeps, 'db'>, id: string): void {
  deps.db.update(pluginInstances).set({ health: null, healthCheckedAt: null }).where(eq(pluginInstances.id, id)).run()
}
