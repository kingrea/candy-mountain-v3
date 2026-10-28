import type { PluginSecrets } from '@candy-mountain/shared'
import type { NetlifyConfig } from '../types/netlify'
import { createNetlifyClient, type NetlifyClientOptions } from './client'

export interface NetlifySite {
  id: string
  name: string
  /** The site's primary URL, custom domain included; null before its first deploy. */
  url: string | null
  adminUrl: string | null
}

export interface NetlifyDeploy {
  id: string
  /** Netlify's deploy state, 'ready' for a live deploy. */
  state: string
  /** Null for deploys made without a commit, such as a CLI or drag-and-drop deploy. */
  commitSha: string | null
  branch: string | null
  /** ISO 8601. */
  deployedAt: string | null
  /** The permalink to this exact deploy. */
  deployUrl: string | null
}

export interface NetlifyOperations {
  getSite(): Promise<NetlifySite>
  /** The deploy published to production, or null when the site has never published one. */
  getCurrentDeploy(): Promise<NetlifyDeploy | null>
}

type Body = Record<string, unknown>

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null)
const isObject = (value: unknown): value is Body => value !== null && typeof value === 'object' && !Array.isArray(value)

function isoDate(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? raw : date.toISOString()
}

/** Never throws itself; each operation throws NetlifyApiError with the token redacted. */
export function createNetlifyOperations(config: NetlifyConfig, secrets: PluginSecrets<'token'>, options: NetlifyClientOptions = {}): NetlifyOperations {
  const site = encodeURIComponent(config.siteId)
  const client = createNetlifyClient(secrets.get('token'), `site ${config.siteId}`, options)

  async function readSite(): Promise<Body & { id: string }> {
    const body = await client.get<unknown>(`/sites/${site}`)
    if (!isObject(body) || typeof body.id !== 'string') throw client.error('invalid_response', `Netlify sent no site for site ${config.siteId}.`)
    return { ...body, id: body.id }
  }

  function toDeploy(body: Body): NetlifyDeploy {
    if (typeof body.id !== 'string') throw client.error('invalid_response', `Netlify sent a deploy without an id for site ${config.siteId}.`)
    return {
      id: body.id,
      state: text(body.state) ?? 'unknown',
      commitSha: text(body.commit_ref),
      branch: text(body.branch),
      deployedAt: isoDate(body.published_at) ?? isoDate(body.created_at),
      deployUrl: text(body.deploy_ssl_url) ?? text(body.deploy_url),
    }
  }

  return Object.freeze({
    async getSite() {
      const body = await readSite()
      return { id: body.id, name: text(body.name) ?? body.id, url: text(body.ssl_url) ?? text(body.url), adminUrl: text(body.admin_url) }
    },

    async getCurrentDeploy() {
      const body = await readSite()
      if (isObject(body.published_deploy)) return toDeploy(body.published_deploy)
      // published_deploy can be absent from the site object, so ask the deploy list for the newest live one.
      const deploys = await client.get<unknown>(`/sites/${site}/deploys?production=true&state=ready&per_page=1`)
      if (!Array.isArray(deploys)) throw client.error('invalid_response', `Netlify sent no deploy list for site ${config.siteId}.`)
      const [latest] = deploys as unknown[]
      if (latest === undefined) return null
      if (!isObject(latest)) throw client.error('invalid_response', `Netlify sent a deploy that is not an object for site ${config.siteId}.`)
      return toDeploy(latest)
    },
  })
}
