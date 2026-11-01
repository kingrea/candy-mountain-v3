import type { AnyPluginType } from '../definition'
import { repositoryPluginType } from './repository'

/** One `<plugin type id>.ts` per type in this folder, each added here unless a capability definition brings it (`claude-code` comes with chat-claude-code, `codex` with chat-codex, `slack` with slack, `netlify` and `heroku` with deployments). */
export const PLUGIN_TYPES: readonly AnyPluginType[] = [repositoryPluginType]
