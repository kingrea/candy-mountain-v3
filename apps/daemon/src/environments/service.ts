import { randomUUID } from 'node:crypto'
import {
  validateLiveVersionSettings,
  type CreateEnvironmentRequest, type Environment, type EnvironmentLiveVersion, type LiveVersionResult,
  type LiveVersionSettings, type Project, type UpdateEnvironmentRequest,
} from '@candy-mountain/shared'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { environments } from '../db/schema'
import type { PluginInstanceDeps } from '../plugins/instances/instances'
import { LIVE_VERSION_SOURCE_REGISTRY } from './builtin-sources'
import { EnvironmentError } from './errors'
import { normaliseLiveVersion } from './live-version'
import type { LiveVersionDeps, LiveVersionSource, LiveVersionSourceRegistry, LiveVersionValidateContext } from './sources'

type Row = typeof environments.$inferSelect

const toEnvironment = (row: Row): Environment => ({ ...row })

export function liveVersionSourceOf(sources: LiveVersionSourceRegistry, id: string): LiveVersionSource {
  const source = sources.byId(id)
  if (!source) throw new EnvironmentError('unknown_source', `Unknown live-version source "${id}"; known sources are ${sources.ids().join(', ')}`)
  return source
}

function validSettings(source: LiveVersionSource, input: unknown, context: LiveVersionValidateContext): LiveVersionSettings {
  const result = validateLiveVersionSettings(source.fields, input)
  const errors = result.ok ? source.validate?.(result.settings, context) ?? [] : result.errors
  if (!result.ok || errors.length) {
    throw new EnvironmentError('invalid_settings', errors.map(e => (e.field ? `${e.field}: ${e.message}` : e.message)).join(' '))
  }
  return result.settings
}

export function listEnvironments(db: Db, projectId: string): Environment[] {
  return db.select().from(environments).where(eq(environments.projectId, projectId))
    .orderBy(asc(environments.createdAt), asc(sql`rowid`)).all().map(toEnvironment)
}

export function findEnvironment(db: Db, projectId: string, id: string): Environment | null {
  const row = db.select().from(environments).where(and(eq(environments.projectId, projectId), eq(environments.id, id))).get()
  return row ? toEnvironment(row) : null
}

export function getEnvironment(db: Db, projectId: string, id: string): Environment {
  const environment = findEnvironment(db, projectId, id)
  if (!environment) throw new EnvironmentError('not_found', `No environment with id "${id}" in this project`)
  return environment
}

function assertNameFree(db: Db, projectId: string, name: string, exceptId?: string): void {
  const clash = db.select({ id: environments.id }).from(environments).where(and(
    eq(environments.projectId, projectId),
    sql`lower(${environments.name}) = lower(${name})`,
    exceptId ? ne(environments.id, exceptId) : undefined,
  )).get()
  if (clash) throw new EnvironmentError('name_taken', `This project already has an environment called "${name}"`)
}

export function createEnvironment(deps: PluginInstanceDeps, projectId: string, input: CreateEnvironmentRequest, sources: LiveVersionSourceRegistry = LIVE_VERSION_SOURCE_REGISTRY): Environment {
  const source = liveVersionSourceOf(sources, input.liveSourceKind)
  const liveSourceSettings = validSettings(source, input.liveSourceSettings ?? {}, { projectId, deps })
  return deps.db.transaction((tx) => {
    assertNameFree(tx, projectId, input.name)
    const now = new Date().toISOString()
    const row: Row = {
      id: randomUUID(),
      projectId,
      name: input.name,
      liveSourceKind: source.id,
      liveSourceSettings,
      deployKind: null,
      deploySettings: null,
      createdAt: now,
      updatedAt: now,
    }
    tx.insert(environments).values(row).run()
    return toEnvironment(row)
  })
}

/** A changed source kind without new settings is validated against an empty object, so its defaults apply. */
export function updateEnvironment(deps: PluginInstanceDeps, projectId: string, id: string, input: UpdateEnvironmentRequest, sources: LiveVersionSourceRegistry = LIVE_VERSION_SOURCE_REGISTRY): Environment {
  return deps.db.transaction((tx) => {
    const current = getEnvironment(tx, projectId, id)
    const liveSourceKind = input.liveSourceKind ?? current.liveSourceKind
    const kindChanged = liveSourceKind !== current.liveSourceKind
    const liveSourceSettings = input.liveSourceSettings !== undefined || kindChanged
      ? validSettings(liveVersionSourceOf(sources, liveSourceKind), input.liveSourceSettings ?? {}, { projectId, deps: { ...deps, db: tx } })
      : current.liveSourceSettings
    if (input.name !== undefined) assertNameFree(tx, projectId, input.name, id)
    const next: Environment = {
      ...current,
      name: input.name ?? current.name,
      liveSourceKind,
      liveSourceSettings,
      updatedAt: new Date().toISOString(),
    }
    tx.update(environments).set({ name: next.name, liveSourceKind, liveSourceSettings, updatedAt: next.updatedAt }).where(eq(environments.id, id)).run()
    return next
  })
}

export function deleteEnvironment(db: Db, projectId: string, id: string): void {
  getEnvironment(db, projectId, id)
  db.delete(environments).where(eq(environments.id, id)).run()
}

/** Upper bound for any one source; the custom endpoint gives up sooner on its own. */
export const LIVE_VERSION_READ_TIMEOUT_MS = 15_000

export interface ReadLiveVersionOptions {
  sources?: LiveVersionSourceRegistry
  fetch?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function readEnvironmentLiveVersion(deps: LiveVersionDeps, project: Project, environment: Environment, options: ReadLiveVersionOptions = {}): Promise<EnvironmentLiveVersion> {
  const { sources = LIVE_VERSION_SOURCE_REGISTRY, timeoutMs = LIVE_VERSION_READ_TIMEOUT_MS } = options
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  let live: LiveVersionResult
  try {
    const source = sources.byId(environment.liveSourceKind)
    if (!source) throw new Error(`The live-version source "${environment.liveSourceKind}" is not available.`)
    const version = await source.read({ settings: environment.liveSourceSettings, project, signal, fetch: options.fetch ?? fetch, deps })
    live = { ok: true, version: normaliseLiveVersion(version) }
  }
  catch (error) {
    live = { ok: false, error: timeout.aborted ? `No answer within ${timeoutMs / 1000}s.` : messageOf(error) }
  }
  return {
    environmentId: environment.id,
    environmentName: environment.name,
    liveSourceKind: environment.liveSourceKind,
    checkedAt: new Date().toISOString(),
    live,
  }
}

/** Reads every environment in parallel; one failing source never fails the others. */
export function readLiveVersions(deps: LiveVersionDeps, project: Project, options: ReadLiveVersionOptions = {}): Promise<EnvironmentLiveVersion[]> {
  return Promise.all(listEnvironments(deps.db, project.id).map(environment => readEnvironmentLiveVersion(deps, project, environment, options)))
}
