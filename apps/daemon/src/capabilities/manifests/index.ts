import type { AnyCapabilityManifest } from '@candy-mountain/shared'
import { botsCapability } from './bots'
import { chatClaudeCodeCapability } from './chat-claude-code'
import { chatCodexCapability } from './chat-codex'
import { deploymentsCapability } from './deployments'
import { issuesCapability } from './issues'
import { overviewCapability } from './overview'
import { platformAgentCapability } from './platform-agent'
import { teamCapability } from './team'
import { uptimeCapability } from './uptime'

/** One `<capability id>.ts` per capability in this folder, each added here. */
export const CAPABILITIES: readonly AnyCapabilityManifest[] = [overviewCapability, issuesCapability, botsCapability, teamCapability, chatClaudeCodeCapability, chatCodexCapability, uptimeCapability, deploymentsCapability, platformAgentCapability]
