import { MANIFEST_ID_PATTERN, type AnyCapabilityManifest } from '@candy-mountain/platform-sdk'
import type { SessionFamily, SessionFamilyRegistry } from '@candy-mountain/platform-sdk/daemon'
import { duplicates } from '../capabilities/manifest'

export type { SessionFamily, SessionFamilyRegistry }

/** Thrown while registering session families, so a bad family or an agent naming an unknown one stops the daemon at boot. */
export class SessionFamilyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionFamilyError'
  }
}

/** The families the platform supplies itself: none, since every family comes with the definition that runs it. */
export const SESSION_FAMILIES: readonly SessionFamily[] = []

export function createSessionFamilyRegistry(families: readonly SessionFamily[]): SessionFamilyRegistry {
  for (const family of families) {
    if (typeof family.id !== 'string' || !MANIFEST_ID_PATTERN.test(family.id)) {
      throw new SessionFamilyError(`Invalid session family id '${String(family.id)}'; ids are lowercase letters and digits joined by '-', '_' or '.'.`)
    }
    if (typeof family.name !== 'string' || family.name.trim() === '') throw new SessionFamilyError(`Session family '${family.id}': name must not be empty.`)
  }
  const dup = duplicates(families.map(f => f.id))
  if (dup.length) throw new SessionFamilyError(`Duplicate session family id(s): ${dup.map(id => `'${id}'`).join(', ')}.`)

  const list = Object.freeze([...families])
  const ids = Object.freeze(list.map(f => f.id))
  const byId = new Map(list.map(f => [f.id, f]))
  return {
    list: () => list,
    ids: () => ids,
    has: id => byId.has(id),
    nameOf: id => byId.get(id)?.name ?? id,
  }
}

export function assertAgentFamilies(capabilities: readonly AnyCapabilityManifest[], families: SessionFamilyRegistry): void {
  for (const cap of capabilities) {
    for (const agent of cap.agents) {
      if (agent.family !== undefined && !families.has(agent.family)) {
        throw new SessionFamilyError(`Capability '${cap.id}': agent '${agent.id}' runs unregistered session family '${agent.family}'.`)
      }
    }
  }
}
