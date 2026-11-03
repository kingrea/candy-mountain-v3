import type { ScopeLabel } from './product'

export const INFO_PATH = '/info'

export interface InfoResponse {
  version: string
  dataDir: string
  authStrategy: string
  productName: string
  scopeLabel: ScopeLabel
}
