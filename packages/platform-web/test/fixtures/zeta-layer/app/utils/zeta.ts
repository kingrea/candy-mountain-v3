import { WORKSPACES_PATH } from '@candy-mountain/platform-sdk'

export interface ZetaRecord {
  id: string
  title: string
}

export interface ZetaRecordListResponse {
  records: ZetaRecord[]
}

export const ZETA_MANAGE_TOOL = 'zeta.manage'

export const zetaRecordsPath = (slug: string) => `${WORKSPACES_PATH}/${slug}/zeta`
