export const PLATFORM_SETTINGS_PATH = '/settings/platform'

export const PLATFORM_SETTINGS_ERROR_CODES = ['invalid_request', 'secrets_locked'] as const
export type PlatformSettingsErrorCode = (typeof PLATFORM_SETTINGS_ERROR_CODES)[number]

/** The gateway key is never part of a response, only whether one is stored. */
export interface PlatformSettings {
  gatewayBaseUrl: string | null
  modelId: string | null
  gatewayKeySet: boolean
  secretsUnlocked: boolean
}

/** Omitted fields stay as they are; null clears the field. */
export interface UpdatePlatformSettingsRequest {
  gatewayBaseUrl?: string | null
  modelId?: string | null
  gatewayKey?: string | null
}
