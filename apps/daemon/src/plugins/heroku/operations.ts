import type { PluginSecrets } from '@candy-mountain/shared'
import type { HerokuConfig } from '../types/heroku'
import { createHerokuClient, type HerokuClientOptions } from './client'

export interface HerokuApp {
  id: string
  name: string
  /** Null for an app without a web URL. */
  webUrl: string | null
}

export type HerokuReleaseStatus = 'succeeded' | 'failed' | 'pending'

export interface HerokuRelease {
  version: number
  /** From the release's slug or OCI image; null when the build carried no commit. */
  commitSha: string | null
  description: string
  /** ISO 8601. */
  createdAt: string
  appUrl: string | null
  status: HerokuReleaseStatus
}

export interface HerokuOperations {
  getApp(): Promise<HerokuApp>
  /** The release serving the app now; null when the app has never been released. */
  getCurrentRelease(): Promise<HerokuRelease | null>
}

// A failed release-phase leaves an older release current, so look back past the newest one.
const RELEASE_LOOKBACK = 10
const STATUSES = new Set<string>(['succeeded', 'failed', 'pending'] satisfies HerokuReleaseStatus[])

interface RawRelease {
  version?: unknown
  description?: unknown
  created_at?: unknown
  status?: unknown
  current?: unknown
  slug?: { id?: unknown } | null
  oci_image?: { id?: unknown } | null
}

const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/** Never throws itself; each operation throws HerokuApiError with the key redacted. */
export function createHerokuOperations(config: HerokuConfig, secrets: PluginSecrets<'apiKey'>, options: HerokuClientOptions = {}): HerokuOperations {
  const client = createHerokuClient(secrets.get('apiKey'), options)
  const app = encodeURIComponent(config.appName)
  const subject = `app '${config.appName}'`

  async function getApp(): Promise<HerokuApp> {
    const raw = await client.get<{ id?: unknown, name?: unknown, web_url?: unknown }>(`/apps/${app}`, subject)
    const id = str(raw?.id)
    const name = str(raw?.name)
    if (!id || !name) throw client.error('invalid_response', `Heroku sent no app for ${subject}.`)
    return { id, name, webUrl: str(raw.web_url) ?? null }
  }

  async function commitOf(release: RawRelease): Promise<string | null> {
    const slugId = str(release.slug?.id)
    const imageId = str(release.oci_image?.id)
    const path = slugId ? `/apps/${app}/slugs/${encodeURIComponent(slugId)}` : imageId ? `/apps/${app}/oci-images/${encodeURIComponent(imageId)}` : undefined
    if (!path) return null
    const build = await client.get<{ commit?: unknown }>(path, `the build of ${subject}`)
    return str(build?.commit) ?? null
  }

  return Object.freeze({
    getApp,

    async getCurrentRelease() {
      const [details, releases] = await Promise.all([
        getApp(),
        client.get<unknown>(`/apps/${app}/releases`, `the releases of ${subject}`, { Range: `version ..; order=desc, max=${RELEASE_LOOKBACK}` }),
      ])
      if (!Array.isArray(releases)) throw client.error('invalid_response', `Heroku sent no release list for ${subject}.`)
      const list = releases.filter((r): r is RawRelease => r !== null && typeof r === 'object')
      const release = list.find(r => r.current === true) ?? list.find(r => r.status === 'succeeded') ?? list[0]
      if (!release) return null

      const version = release.version
      const createdAt = str(release.created_at)
      const status = str(release.status)
      if (typeof version !== 'number' || !createdAt || !status || !STATUSES.has(status)) {
        throw client.error('invalid_response', `Heroku sent an incomplete release for ${subject}.`)
      }
      return {
        version,
        commitSha: await commitOf(release),
        description: typeof release.description === 'string' ? release.description : '',
        createdAt,
        appUrl: details.webUrl,
        status: status as HerokuReleaseStatus,
      }
    },
  })
}
