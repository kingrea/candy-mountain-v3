import type { AnyPluginType } from '../definition'
import { claudeCodePluginType } from './claude-code'
import { codexPluginType } from './codex'
import { herokuPluginType } from './heroku'
import { netlifyPluginType } from './netlify'
import { repositoryPluginType } from './repository'
import { slackPluginType } from './slack'

/** One `<plugin type id>.ts` per type in this folder, each added here. */
export const PLUGIN_TYPES: readonly AnyPluginType[] = [repositoryPluginType, slackPluginType, herokuPluginType, netlifyPluginType, claudeCodePluginType, codexPluginType]
