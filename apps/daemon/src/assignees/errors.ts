import type { AssigneeErrorCode } from '@candy-mountain/shared'

export class AssigneeError extends Error {
  readonly code: AssigneeErrorCode
  readonly status = 400 as const

  constructor(code: AssigneeErrorCode, message: string) {
    super(message)
    this.name = 'AssigneeError'
    this.code = code
  }
}
