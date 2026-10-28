import type { PluginInstanceErrorCode } from '@candy-mountain/shared'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS: Record<PluginInstanceErrorCode, ContentfulStatusCode> = {
  invalid_request: 400,
  not_found: 404,
  action_not_found: 404,
  project_not_found: 422,
  type_not_found: 422,
  unsupported_scope: 422,
  invalid_config: 422,
  invalid_secrets: 422,
  instance_exists: 409,
  secrets_locked: 409,
  instance_changed: 409,
}

export class PluginInstanceError extends Error {
  readonly code: PluginInstanceErrorCode
  readonly status: ContentfulStatusCode

  constructor(code: PluginInstanceErrorCode, message: string) {
    super(message)
    this.name = 'PluginInstanceError'
    this.code = code
    this.status = STATUS[code]
  }
}
