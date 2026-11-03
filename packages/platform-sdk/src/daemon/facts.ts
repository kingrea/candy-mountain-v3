import type { ScopeLabel, Workspace } from '../index'
import type { Db } from './db'

/** The facts the platform computes itself, the same for every workspace and actor. */
export const PLATFORM_FACT_IDS = ['llmGateway'] as const

/** A fact left out counts as false. */
export type PlatformFacts = Partial<Record<(typeof PLATFORM_FACT_IDS)[number], boolean>>

/** Every declared fact for one workspace, as the definitions computed it; a fact left out counts as false. */
export type WorkspaceFacts = Readonly<Record<string, boolean>>

/** The readiness message of each declared fact, named with the product's scope label. */
export type WorkspaceFactMessages = Readonly<Record<string, (label: ScopeLabel) => string>>

/** A fact about a workspace a capability can answer, declared on its definition and read by the registry loader. */
export interface WorkspaceFactDeclaration {
  id: string
  /** Runs on every registry read and gate check, so it must be cheap: a row lookup, never the network. */
  compute(db: Db, workspace: Pick<Workspace, 'id'>): boolean
  /** The readiness reason shown when the fact does not hold, e.g. `The ${label.singular} has no bots yet.` */
  message(label: ScopeLabel): string
}

export interface WorkspaceFactRegistry {
  /** In registration order. */
  list(): readonly string[]
  has(id: string): boolean
  /** Every declared fact for the workspace, each asked of its declaration. */
  compute(db: Db, workspace: Pick<Workspace, 'id'>): WorkspaceFacts
  messages(): WorkspaceFactMessages
}
