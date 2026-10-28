import { validatePluginConfig, type PluginConfigOf, type PluginHealth } from '@candy-mountain/shared'
import { definePluginType } from '../definition'
import { createHerokuOperations } from '../heroku/operations'

export const herokuPluginType = definePluginType({
  id: 'heroku',
  name: 'Heroku',
  description: 'The project\'s app on Heroku.',
  reach: [
    'Read the app and its releases to show what is live.',
  ],
  scopes: ['project'],
  singleInstance: true,
  configFields: [
    { kind: 'string', name: 'appName', label: 'App name', description: 'The app\'s name as shown in the Heroku dashboard.', required: true, placeholder: 'my-app', pattern: '[a-z][a-z0-9-]*[a-z0-9]' },
  ],
  secretFields: [
    { name: 'apiKey', label: 'API key', description: 'A Heroku API key or authorization token that can read the app.', required: true },
  ],
  async healthCheck({ config, secrets, signal }): Promise<PluginHealth> {
    const app = await createHerokuOperations(config, secrets, { signal }).getApp()
    return { healthy: true, detail: `Can read Heroku app '${app.name}'.` }
  },
})

export type HerokuConfig = PluginConfigOf<typeof herokuPluginType.configFields>

/** Narrows a stored instance config, throwing when it no longer validates. */
export function herokuConfig(config: unknown): HerokuConfig {
  const result = validatePluginConfig(herokuPluginType.configFields, config)
  if (!result.ok) throw new Error(`Invalid Heroku config: ${result.errors.map(e => (e.field ? `${e.field}: ${e.message}` : e.message)).join(' ')}`)
  return result.config as HerokuConfig
}
