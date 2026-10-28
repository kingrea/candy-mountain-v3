import type { PluginConfig, PluginHealth, PluginSecrets } from '@candy-mountain/shared'
import type { DataPaths } from '../data-dir'
import type { AnyPluginType, PluginHealthInstance } from './definition'

export const DEFAULT_HEALTH_TIMEOUT_MS = 15_000

export interface CheckPluginHealthOptions {
  config: PluginConfig
  secrets: PluginSecrets
  timeoutMs?: number
  instance?: PluginHealthInstance
  paths?: DataPaths
}

/** Never throws: a thrown error, a timeout or a malformed result all become unhealthy with a reason. */
export async function checkPluginHealth(type: AnyPluginType, { config, secrets, timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS, instance, paths }: CheckPluginHealthOptions): Promise<PluginHealth> {
  const read = new Set<string>()
  const tracked: PluginSecrets = {
    get(name) {
      const value = secrets.get(name)
      if (value) read.add(value)
      return value
    },
  }
  // Health checks often echo vendor errors, which can quote the credential back.
  const redact = (text: string) => [...read].reduce((out, value) => out.split(value).join('[redacted]'), text)

  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<PluginHealth>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve({ healthy: false, reason: `Health check timed out after ${timeoutMs} ms.` })
    }, timeoutMs)
  })

  try {
    const result = await Promise.race([Promise.resolve().then(() => type.healthCheck({ config, secrets: tracked, signal: controller.signal, instance, paths })), timeout])
    if (result?.healthy === true) return result.detail === undefined ? { healthy: true } : { healthy: true, detail: redact(String(result.detail)) }
    if (result?.healthy === false && typeof result.reason === 'string' && result.reason.trim()) return { healthy: false, reason: redact(result.reason) }
    return { healthy: false, reason: 'Health check returned no result.' }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { healthy: false, reason: redact(message || 'Health check failed.') }
  }
  finally {
    clearTimeout(timer)
  }
}
