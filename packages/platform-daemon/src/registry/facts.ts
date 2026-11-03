import { FACT_ID_PATTERN, type AnyCapabilityManifest } from '@candy-mountain/platform-sdk'
import type { CapabilityDefinition, WorkspaceFactDeclaration, WorkspaceFactMessages, WorkspaceFactRegistry } from '@candy-mountain/platform-sdk/daemon'
import { duplicates } from '../capabilities/manifest'

/** Thrown while registering workspace facts, or when a manifest requires a fact nothing declares. */
export class WorkspaceFactError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceFactError'
  }
}

export type { WorkspaceFactDeclaration, WorkspaceFactRegistry }

const isId = (value: unknown): value is string => typeof value === 'string' && FACT_ID_PATTERN.test(value)
const quoted = (values: readonly unknown[]) => values.map(v => `'${String(v)}'`).join(', ')

export function createWorkspaceFactRegistry(declarations: readonly WorkspaceFactDeclaration[]): WorkspaceFactRegistry {
  const ids = declarations.map(d => d?.id)
  const bad = ids.filter(id => !isId(id))
  if (bad.length) throw new WorkspaceFactError(`Invalid workspace fact id(s) ${quoted(bad)}; fact ids are camelCase words such as 'hasBeads'.`)
  const dup = duplicates(ids)
  if (dup.length) throw new WorkspaceFactError(`Duplicate workspace fact id(s): ${quoted(dup)}.`)
  const uncomputable = declarations.filter(d => typeof d.compute !== 'function')
  if (uncomputable.length) throw new WorkspaceFactError(`Workspace fact(s) ${quoted(uncomputable.map(d => d.id))}: compute must be a function.`)
  const unworded = declarations.filter(d => typeof d.message !== 'function')
  if (unworded.length) throw new WorkspaceFactError(`Workspace fact(s) ${quoted(unworded.map(d => d.id))}: message must be a function.`)

  const list = Object.freeze([...ids])
  const known = new Set(list)
  const messages: WorkspaceFactMessages = Object.freeze(Object.fromEntries(declarations.map(d => [d.id, d.message])))
  return {
    list: () => list,
    has: id => known.has(id),
    compute: (db, workspace) => Object.fromEntries(declarations.map(d => [d.id, d.compute(db, workspace) === true])),
    messages: () => messages,
  }
}

/** Every fact the definitions declare, in definition order. */
export const declaredWorkspaceFacts = (definitions: readonly CapabilityDefinition[]): WorkspaceFactDeclaration[] =>
  definitions.flatMap(d => d.workspaceFacts ?? [])

/** The open-id rule for facts: a manifest may require only what a definition in the list declares. */
export function assertRequiredWorkspaceFacts(manifests: readonly AnyCapabilityManifest[], facts: Pick<WorkspaceFactRegistry, 'has'>): void {
  for (const cap of manifests) {
    for (const fact of cap.requiresWorkspaceFacts ?? []) {
      if (!facts.has(fact)) throw new WorkspaceFactError(`Capability '${cap.id}' requires workspace fact '${fact}', which no definition declares.`)
    }
  }
}
