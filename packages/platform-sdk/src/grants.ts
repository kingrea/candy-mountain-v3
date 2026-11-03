import type { CapabilityId } from './capabilities'
import type { ModuleId } from './modules'

export const GRANTS_PATH = '/grants'

export const GRANT_TARGET_KINDS = ['module', 'capability'] as const
export type GrantTargetKind = (typeof GRANT_TARGET_KINDS)[number]

export type GrantTarget =
  | { kind: 'module', id: ModuleId }
  | { kind: 'capability', id: CapabilityId }

/** Rung name per capability id. */
export type CapabilityRungs = Record<CapabilityId, string>

export interface RoleGrant {
  /** Role slug. */
  role: string
  target: GrantTarget
  /** Module grants: members left out get the module's default rung. Capability grants: exactly the target. */
  rungs: CapabilityRungs
  createdAt: string
  updatedAt: string
}

export interface RoleRungs {
  role: string
  name: string
  /** Resolved rung of every registered capability, 'none' included. */
  rungs: CapabilityRungs
}

export interface GrantListResponse {
  grants: RoleGrant[]
  roles: RoleRungs[]
}

export interface SetGrantRequest {
  role: string
  target: GrantTarget
  rungs: CapabilityRungs
}

export interface GrantResponse {
  grant: RoleGrant
}

export const GRANT_ERROR_CODES = ['invalid_request', 'role_not_found', 'target_not_found', 'invalid_rung'] as const
export type GrantErrorCode = (typeof GRANT_ERROR_CODES)[number]
