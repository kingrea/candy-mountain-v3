export const WEB_URL_ENV = 'CM_WEB_URL'
export const DEFAULT_WEB_URL = 'http://127.0.0.1:4300'

export interface NotificationSettings {
  /** Origin of the web app, used to turn in-app paths into links Slack can open. No trailing slash. */
  webUrl: string
}

export function resolveNotificationSettings(env: NodeJS.ProcessEnv = process.env): NotificationSettings {
  const raw = env[WEB_URL_ENV]?.trim()
  if (!raw) return { webUrl: DEFAULT_WEB_URL }
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    throw new Error(`${WEB_URL_ENV} must be an http(s) URL such as ${DEFAULT_WEB_URL}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${WEB_URL_ENV} must be an http(s) URL such as ${DEFAULT_WEB_URL}`)
  return { webUrl: raw.replace(/\/+$/, '') }
}
