import { validatePluginConfig, type PluginConfigOf, type PluginHealth } from '@candy-mountain/shared'
import { definePluginType } from '../definition'
import { createNetlifyOperations } from '../netlify/operations'

export const netlifyPluginType = definePluginType({
  id: 'netlify',
  name: 'Netlify',
  description: 'The project\'s site on Netlify.',
  reach: [
    'Read the site and its deploys.',
    'Show which commit and branch are live in production.',
  ],
  scopes: ['project'],
  singleInstance: true,
  configFields: [
    { kind: 'string', name: 'siteId', label: 'Site ID', description: 'The site\'s ID from Site configuration, or its netlify.app domain.', required: true, placeholder: '3970e0fe-8564-4903-9a55-c5f8de49fb8b', pattern: '[A-Za-z0-9][A-Za-z0-9.-]*' },
  ],
  secretFields: [
    { name: 'token', label: 'Personal access token', description: 'A Netlify personal access token from an account that can see the site.', required: true },
  ],
  async healthCheck({ config, secrets, signal }): Promise<PluginHealth> {
    const site = await createNetlifyOperations(config, secrets, { signal }).getSite()
    return { healthy: true, detail: `Can read the site ${site.name}${site.url ? ` (${site.url})` : ''}.` }
  },
})

export type NetlifyConfig = PluginConfigOf<typeof netlifyPluginType.configFields>

/** Narrows a stored instance config, throwing when it no longer validates. */
export function netlifyConfig(config: unknown): NetlifyConfig {
  const result = validatePluginConfig(netlifyPluginType.configFields, config)
  if (!result.ok) throw new Error(`Invalid Netlify config: ${result.errors.map(e => (e.field ? `${e.field}: ${e.message}` : e.message)).join(' ')}`)
  return result.config as NetlifyConfig
}
