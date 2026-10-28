export const INFO_PATH = '/info'

export interface InfoResponse {
  version: string
  dataDir: string
  authStrategy: string
}
