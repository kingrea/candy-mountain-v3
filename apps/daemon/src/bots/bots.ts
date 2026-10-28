import { randomUUID } from 'node:crypto'
import {
  BOT_FAMILY_NAMES,
  BOT_SECRET_NAMES,
  type Bot,
  type BotFamily,
  type BotPersonaStatus,
  type BotSecretName,
  type BotSecretValues,
} from '@candy-mountain/shared'
import { and, eq, ne, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { bots } from '../db/schema'
import { resolvePluginInstance, type PluginInstanceDeps, type SecretsReader } from '../plugins/instances/instances'
import { createRepositoryOperations, repositoryConfig, repositoryPluginType } from '../plugins/repository'
import { createPluginSecrets } from '../plugins/secrets'
import { BotError } from './errors'
import { botUsableWithoutSlack, computeBotStatus } from './status'
import type { CreateBotInput, UpdateBotInput } from './validation'

/** `c.var` and `Platform` both satisfy this. */
export type BotDeps = PluginInstanceDeps

/** Reading a bot resolves a blank base branch through the Repository plugin, which needs its token. */
export interface BotReadDeps extends BotDeps {
  secretsReader: SecretsReader
}

export interface BotReadOptions {
  signal?: AbortSignal
}

type BotRow = typeof bots.$inferSelect
type DefaultBranch = { branch: string } | { error: string }

const DEFAULT_BRANCH_TIMEOUT_MS = 10_000

export const botSecretOwner = (botId: string) => `bot:${botId}`

/** Daemon-side only (Socket Mode); never hand it to routes. */
export function createBotSecrets(store: SecretsReader, botId: string) {
  const owner = botSecretOwner(botId)
  return Object.freeze({ get: (name: BotSecretName) => store.get(owner, name) })
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function readDefaultBranch(deps: BotReadDeps, projectId: string, { signal }: BotReadOptions): Promise<DefaultBranch> {
  const instance = resolvePluginInstance(deps, projectId, 'repository')
  if (!instance) return { error: 'the Repository plugin is not set up' }
  const timeout = AbortSignal.timeout(DEFAULT_BRANCH_TIMEOUT_MS)
  try {
    const secrets = createPluginSecrets(deps.secretsReader, instance.id, repositoryPluginType)
    const operations = createRepositoryOperations(repositoryConfig(instance.config), secrets, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    return { branch: await operations.getDefaultBranch() }
  }
  catch (error) {
    return { error: errorMessage(error) }
  }
}

/** Per-project lookups shared by every bot in one read, so a list makes at most one host call per project. */
function projectContext(deps: BotReadDeps, options: BotReadOptions) {
  const families = new Map<string, ReturnType<typeof resolvePluginInstance>>()
  const branches = new Map<string, Promise<DefaultBranch>>()
  return {
    familyPlugin(projectId: string, family: BotFamily) {
      const key = `${projectId}:${family}`
      if (!families.has(key)) families.set(key, resolvePluginInstance(deps, projectId, family))
      return families.get(key)!
    },
    defaultBranch(projectId: string) {
      if (!branches.has(projectId)) branches.set(projectId, readDefaultBranch(deps, projectId, options))
      return branches.get(projectId)!
    },
  }
}

async function toBot(deps: BotReadDeps, row: BotRow, context: ReturnType<typeof projectContext>): Promise<Bot> {
  const owner = botSecretOwner(row.id)
  const secrets = Object.fromEntries(BOT_SECRET_NAMES.map(name => [name, deps.secrets.isSet(owner, name) ? 'set' : 'unset'])) as Bot['secrets']
  const persona = { name: row.personaName, status: row.personaStatus, checkedAt: row.personaCheckedAt, reason: row.personaReason }
  const defaultBranch = row.baseBranch === null ? await context.defaultBranch(row.projectId) : null
  const effectiveBaseBranch = row.baseBranch ?? (defaultBranch && 'branch' in defaultBranch ? defaultBranch.branch : null)
  const baseBranchProblem = defaultBranch && 'error' in defaultBranch
    ? `The base branch is blank and the repository's default branch could not be read: ${defaultBranch.error}`
    : null
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    family: row.family,
    writeScope: row.writeScope,
    baseBranch: row.baseBranch,
    effectiveBaseBranch,
    persona,
    answersIn: row.answersIn,
    secrets,
    status: computeBotStatus({ family: row.family, familyPlugin: context.familyPlugin(row.projectId, row.family), persona, secrets, baseBranchProblem }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Without a project: every bot on the platform. Ordered by name within each project. */
export async function listBots(deps: BotReadDeps, { projectId, ...options }: BotReadOptions & { projectId?: string } = {}): Promise<Bot[]> {
  const rows = deps.db.select().from(bots)
    .where(projectId === undefined ? undefined : eq(bots.projectId, projectId))
    .orderBy(bots.projectId, sql`lower(${bots.name})`, bots.createdAt)
    .all()
  const context = projectContext(deps, options)
  return Promise.all(rows.map(row => toBot(deps, row, context)))
}

export async function findBot(deps: BotReadDeps, id: string, options: BotReadOptions = {}): Promise<Bot | null> {
  const row = deps.db.select().from(bots).where(eq(bots.id, id)).get()
  return row ? toBot(deps, row, projectContext(deps, options)) : null
}

export async function getBot(deps: BotReadDeps, id: string, options: BotReadOptions = {}): Promise<Bot> {
  const bot = await findBot(deps, id, options)
  if (!bot) throw new BotError('not_found', `No bot with id "${id}"`)
  return bot
}

/** A cheap ownership check that skips the host call a full read makes. */
export function botProjectId(db: Db, id: string): string | null {
  return db.select({ projectId: bots.projectId }).from(bots).where(eq(bots.id, id)).get()?.projectId ?? null
}

/** The project's bots in a thread-ready shape, read without the host call `listBots` makes. */
export interface ProjectBotRef {
  id: string
  name: string
  family: BotFamily
  writeScope: Bot['writeScope']
  baseBranch: string | null
  /** Everything but the Slack keys is in place; a blank base branch is only resolved when a session starts. */
  usable: boolean
}

export function listProjectBotRefs(deps: BotDeps, projectId: string): ProjectBotRef[] {
  const families = new Map<BotFamily, ReturnType<typeof resolvePluginInstance>>()
  const familyPlugin = (family: BotFamily) => {
    if (!families.has(family)) families.set(family, resolvePluginInstance(deps, projectId, family))
    return families.get(family)!
  }
  return deps.db.select().from(bots).where(eq(bots.projectId, projectId)).orderBy(sql`lower(${bots.name})`, bots.createdAt).all().map(row => ({
    id: row.id,
    name: row.name,
    family: row.family,
    writeScope: row.writeScope,
    baseBranch: row.baseBranch,
    usable: botUsableWithoutSlack({ family: row.family, familyPlugin: familyPlugin(row.family), persona: { name: row.personaName, status: row.personaStatus, reason: row.personaReason }, baseBranchProblem: null }),
  }))
}

function getBotRow(db: Db, id: string): BotRow {
  const row = db.select().from(bots).where(eq(bots.id, id)).get()
  if (!row) throw new BotError('not_found', `No bot with id "${id}"`)
  return row
}

function assertRepositoryConfigured(deps: BotDeps, projectId: string) {
  const instance = resolvePluginInstance(deps, projectId, 'repository')
  const type = deps.pluginTypes.byId('repository')
  const configured = instance !== null && (type?.secretFields ?? []).every(f => !f.required || instance.secrets[f.name] === 'set')
  if (!configured) throw new BotError('repository_not_configured', 'Set up the Repository plugin for this project before adding bots')
}

/** Uses the stored test result rather than re-running the check, so a save never waits on a login probe. */
function assertFamilyHealthy(deps: BotDeps, projectId: string, family: BotFamily) {
  const name = BOT_FAMILY_NAMES[family]
  const health = resolvePluginInstance(deps, projectId, family)?.health
  if (health?.healthy) return
  const why = health === undefined ? 'is not set up for this project' : health === null ? 'has not been tested since it last changed' : `is unhealthy: ${health.reason}`
  throw new BotError('family_unavailable', `${name} cannot be chosen because the ${name} plugin ${why}`)
}

function assertNameFree(db: Db, projectId: string, name: string, exceptId?: string) {
  const sameName = and(eq(bots.projectId, projectId), sql`lower(${bots.name}) = lower(${name})`, exceptId ? ne(bots.id, exceptId) : undefined)
  if (db.select({ id: bots.id }).from(bots).where(sameName).get()) throw new BotError('name_taken', `This project already has a bot named "${name}"`)
}

interface SecretChanges {
  set: [BotSecretName, string][]
  clear: BotSecretName[]
}

function secretChanges(deps: BotDeps, values: BotSecretValues): SecretChanges {
  const changes: SecretChanges = { set: [], clear: [] }
  for (const name of BOT_SECRET_NAMES) {
    const value = values[name]
    if (typeof value === 'string' && value !== '') changes.set.push([name, value])
    else if (value === null) changes.clear.push(name)
  }
  if (changes.set.length && !deps.secrets.unlocked) {
    throw new BotError('secrets_locked', 'Secrets are locked because CM_SECRETS_KEY is not set, so the Slack keys cannot be saved')
  }
  return changes
}

function applySecrets(deps: BotDeps, id: string, changes: SecretChanges) {
  const owner = botSecretOwner(id)
  for (const [name, value] of changes.set) deps.secrets.set(owner, name, value)
  for (const name of changes.clear) deps.secrets.delete(owner, name)
}

export async function createBot(deps: BotReadDeps, projectId: string, input: CreateBotInput, options: BotReadOptions = {}): Promise<Bot> {
  assertRepositoryConfigured(deps, projectId)
  assertFamilyHealthy(deps, projectId, input.family)
  const { secrets, ...fields } = input
  const changes = secretChanges(deps, secrets)

  const id = randomUUID()
  const now = new Date().toISOString()
  deps.db.transaction((tx) => {
    assertNameFree(tx, projectId, input.name)
    tx.insert(bots).values({ ...fields, id, projectId, createdAt: now, updatedAt: now }).run()
  })
  try {
    applySecrets(deps, id, changes)
  }
  catch (error) {
    deps.db.delete(bots).where(eq(bots.id, id)).run()
    deps.secrets.deleteOwner(botSecretOwner(id))
    throw error
  }
  return getBot(deps, id, options)
}

/** A new persona name, family or base branch points at a different persona file, so the last check no longer applies. */
export async function updateBot(deps: BotReadDeps, id: string, input: UpdateBotInput, options: BotReadOptions = {}): Promise<Bot> {
  const existing = getBotRow(deps.db, id)
  const { secrets, ...fields } = input
  const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(existing[key as keyof BotRow])))

  assertRepositoryConfigured(deps, existing.projectId)
  if (changed.family) assertFamilyHealthy(deps, existing.projectId, changed.family as BotFamily)
  const changes = secretChanges(deps, secrets)

  if (Object.keys(changed).length) {
    const personaChanged = 'personaName' in changed || 'family' in changed || 'baseBranch' in changed
    deps.db.transaction((tx) => {
      if (changed.name) assertNameFree(tx, existing.projectId, changed.name as string, id)
      tx.update(bots)
        .set({
          ...changed,
          ...(personaChanged ? { personaStatus: 'unverified', personaCheckedAt: null, personaReason: null } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(bots.id, id))
        .run()
    })
  }
  applySecrets(deps, id, changes)
  return getBot(deps, id, options)
}

export function deleteBot(deps: Pick<BotDeps, 'db' | 'secrets'>, id: string): void {
  const removed = deps.db.delete(bots).where(eq(bots.id, id)).run()
  if (removed.changes === 0) throw new BotError('not_found', `No bot with id "${id}"`)
  deps.secrets.deleteOwner(botSecretOwner(id))
}

/** Call before deleting a project: the rows would cascade, but their secrets live outside the database. */
export function deleteProjectBots(deps: Pick<BotDeps, 'db' | 'secrets'>, projectId: string): number {
  const ids = deps.db.select({ id: bots.id }).from(bots).where(eq(bots.projectId, projectId)).all().map(r => r.id)
  deps.db.delete(bots).where(eq(bots.projectId, projectId)).run()
  for (const id of ids) deps.secrets.deleteOwner(botSecretOwner(id))
  return ids.length
}

export interface PersonaCheckResult {
  status: Exclude<BotPersonaStatus, 'unverified'>
  reason?: string | null
}

/** Guarded on the bot's `updatedAt` from when the check started, so a slow check never lands on a renamed persona. */
export function recordBotPersonaCheck(db: Db, id: string, checkedUpdatedAt: string, result: PersonaCheckResult): boolean {
  getBotRow(db, id)
  const stored = db.update(bots)
    .set({ personaStatus: result.status, personaReason: result.status === 'verified' ? null : (result.reason ?? null), personaCheckedAt: new Date().toISOString() })
    .where(and(eq(bots.id, id), eq(bots.updatedAt, checkedUpdatedAt)))
    .run()
  return stored.changes > 0
}
