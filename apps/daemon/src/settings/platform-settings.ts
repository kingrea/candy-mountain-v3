import type { PlatformSettings, PlatformSettingsErrorCode, UpdatePlatformSettingsRequest } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import type { Db } from '../db'
import { platformMeta } from '../db/schema'
import type { SecretsStore, SecretsWriter } from '../secrets'

export const LLM_GATEWAY_SECRET_OWNER = 'platform:llm-gateway'
export const LLM_GATEWAY_SECRET_NAME = 'api-key'

export const SETTING_KEYS = {
  gatewayBaseUrl: 'llm.gatewayBaseUrl',
  modelId: 'platformAgent.modelId',
} as const

export class PlatformSettingsError extends Error {
  override name = 'PlatformSettingsError'

  constructor(readonly code: PlatformSettingsErrorCode, message: string, readonly status: 400 | 409 = 400) {
    super(message)
  }
}

function getSetting(db: Db, key: string): string | null {
  return db.select({ value: platformMeta.value }).from(platformMeta).where(eq(platformMeta.key, key)).get()?.value ?? null
}

function setSetting(db: Db, key: string, value: string | null) {
  if (value === null) {
    db.delete(platformMeta).where(eq(platformMeta.key, key)).run()
    return
  }
  const updatedAt = new Date().toISOString()
  db.insert(platformMeta).values({ key, value, updatedAt }).onConflictDoUpdate({ target: platformMeta.key, set: { value, updatedAt } }).run()
}

export function readPlatformSettings(db: Db, secrets: SecretsWriter): PlatformSettings {
  return {
    gatewayBaseUrl: getSetting(db, SETTING_KEYS.gatewayBaseUrl),
    modelId: getSetting(db, SETTING_KEYS.modelId),
    gatewayKeySet: secrets.isSet(LLM_GATEWAY_SECRET_OWNER, LLM_GATEWAY_SECRET_NAME),
    secretsUnlocked: secrets.unlocked,
  }
}

type Field = 'gatewayBaseUrl' | 'modelId' | 'gatewayKey'

function text(body: Record<string, unknown>, field: Field): string | null | undefined {
  const value = body[field]
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') throw new PlatformSettingsError('invalid_request', `${field} must be a string or null`)
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function parseUpdatePlatformSettings(body: unknown): UpdatePlatformSettingsRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new PlatformSettingsError('invalid_request', 'Request body must be a JSON object')
  }
  const record = body as Record<string, unknown>
  const request: UpdatePlatformSettingsRequest = {}
  const gatewayBaseUrl = text(record, 'gatewayBaseUrl')
  if (gatewayBaseUrl !== undefined) {
    if (gatewayBaseUrl !== null && !isHttpUrl(gatewayBaseUrl)) throw new PlatformSettingsError('invalid_request', 'gatewayBaseUrl must be an http(s) URL')
    request.gatewayBaseUrl = gatewayBaseUrl
  }
  const modelId = text(record, 'modelId')
  if (modelId !== undefined) request.modelId = modelId
  const gatewayKey = text(record, 'gatewayKey')
  if (gatewayKey !== undefined) request.gatewayKey = gatewayKey
  return request
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function updatePlatformSettings(db: Db, secrets: SecretsWriter, request: UpdatePlatformSettingsRequest): PlatformSettings {
  if (typeof request.gatewayKey === 'string' && !secrets.unlocked) {
    throw new PlatformSettingsError('secrets_locked', 'The secrets master key is not configured, so the gateway key cannot be saved', 409)
  }
  if (request.gatewayBaseUrl !== undefined) setSetting(db, SETTING_KEYS.gatewayBaseUrl, request.gatewayBaseUrl)
  if (request.modelId !== undefined) setSetting(db, SETTING_KEYS.modelId, request.modelId)
  if (request.gatewayKey === null) secrets.delete(LLM_GATEWAY_SECRET_OWNER, LLM_GATEWAY_SECRET_NAME)
  else if (request.gatewayKey !== undefined) secrets.set(LLM_GATEWAY_SECRET_OWNER, LLM_GATEWAY_SECRET_NAME, request.gatewayKey)
  return readPlatformSettings(db, secrets)
}

export interface LlmGatewayConfig {
  baseUrl: string | null
  modelId: string | null
  apiKey: string | undefined
}

/** Daemon-internal: returns the decrypted key, so never pass the result to HTTP code. */
export function resolveLlmGatewayConfig(db: Db, secrets: SecretsStore): LlmGatewayConfig {
  return {
    baseUrl: getSetting(db, SETTING_KEYS.gatewayBaseUrl),
    modelId: getSetting(db, SETTING_KEYS.modelId),
    apiKey: secrets.get(LLM_GATEWAY_SECRET_OWNER, LLM_GATEWAY_SECRET_NAME),
  }
}
