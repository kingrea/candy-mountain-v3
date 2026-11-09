import { validatePluginConfig, type PluginConfigOf, type PluginHealth } from '@crab-shack/platform-sdk'
import { definePluginType } from '@crab-shack/platform-daemon'
import { createSlackOperations } from './operations'

export const slackPluginType = definePluginType({
  id: 'slack',
  name: 'Slack',
  description: 'A Slack bot that sends this project\'s notifications when none of its bots has a Slack token.',
  reach: [
    'Post messages to Slack channels the bot has been added to.',
    'Send direct messages to members of the workspace.',
  ],
  scopes: ['workspace'],
  singleInstance: true,
  configFields: [
    { kind: 'string', name: 'defaultChannelId', label: 'Default channel ID', description: 'Where messages go when no channel or member is given; the bot must be in the channel.', placeholder: 'C0123456789', pattern: '[CG][A-Z0-9]+' },
  ],
  secretFields: [
    { name: 'botToken', label: 'Bot token', description: 'The app\'s Bot User OAuth Token (xoxb-...) with the chat:write and im:write scopes.', required: true },
  ],
  async healthCheck({ config, secrets, signal }): Promise<PluginHealth> {
    const identity = await createSlackOperations(config, secrets, { signal }).authTest()
    return { healthy: true, detail: `Connected to ${identity.team} as @${identity.user}.` }
  },
})

export type SlackConfig = PluginConfigOf<typeof slackPluginType.configFields>

/** Narrows a stored instance config, throwing when it no longer validates. */
export function slackConfig(config: unknown): SlackConfig {
  const result = validatePluginConfig(slackPluginType.configFields, config)
  if (!result.ok) throw new Error(`Invalid Slack config: ${result.errors.map(e => (e.field ? `${e.field}: ${e.message}` : e.message)).join(' ')}`)
  return result.config as SlackConfig
}
