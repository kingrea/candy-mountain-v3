import {
  BOT_FAMILY_NAMES,
  HANDOFF_OUTCOMES,
  REPOSITORY_HOST_NAMES,
  type Bot,
  type BotFamily,
  type BotWriteScope,
  type Handoff,
  type RepositoryHost,
} from '@candy-mountain/shared'
import { claudeMcpToolRule, SLACK_POST_BLOCKS_TOOL } from '../agent-mcp/tools'
import { resolvePluginInstance } from '../plugins/instances/instances'
import { repositoryConfig } from '../plugins/repository'
import type { BotDeps } from './bots'
import { BotError } from './errors'

export type DependencyInstallState = boolean | 'failed'

export interface SurfaceInstructionsInput {
  family: BotFamily
  botName: string
  personaName: string | null
  branch: string
  baseBranch: string
  host: RepositoryHost
  repository: { owner: string, repo: string }
  writeScope: BotWriteScope
  dependenciesInstalled: DependencyInstallState
  /** Whether `bd` in the session resolves to the project's main issue database. */
  issueTrackerNote: boolean
  /** Only Slack-held sessions get the post_blocks tool, so only they are told about it. */
  holderKind?: 'slack' | 'console'
}

export interface BotSessionRuntime {
  branch: string
  dependenciesInstalled: DependencyInstallState
  issueTrackerNote: boolean
  holderKind?: 'slack' | 'console'
  /** The branch the worktree was cut from; defaults to the bot's effective base branch. */
  baseBranch?: string
}

/** Typed against `Handoff` so a new field cannot be added to the parser without a line here. */
export const HANDOFF_INSTRUCTION_FIELDS: Record<keyof Handoff, { key: string, value: string }> = {
  outcome: { key: 'outcome', value: `<${HANDOFF_OUTCOMES.join('|')}>` },
  summary: { key: 'summary', value: '<one line>' },
  pullRequest: { key: 'pull_request', value: '<URL or none>' },
  issues: { key: 'issues', value: '<comma-separated issue ids or none>' },
  followUps: { key: 'follow_ups', value: '<semicolon-separated follow-ups or none>' },
}

export const HANDOFF_INFO_STRING = 'handoff'

const REPOSITORY_URLS: Record<RepositoryHost, (owner: string, repo: string) => string> = {
  github: (owner, repo) => `https://github.com/${owner}/${repo}`,
  bitbucket: (owner, repo) => `https://bitbucket.org/${owner}/${repo}`,
}

const FRAMING: Record<BotFamily, string> = {
  'claude-code': 'These system-level instructions come from the Candy Mountain platform and follow the persona.',
  'codex': 'These developer instructions come from the Candy Mountain platform and follow the persona.',
}

const WRITE_SCOPE_LINES: Record<BotWriteScope, string> = {
  'read-only': 'Your access is read-only: do not edit files, commit or push. Investigate and describe the changes instead.',
  'write-confirm': 'You may edit, commit and push, but the user confirms those actions; wait for the answer rather than working around it.',
  'write-auto': 'You may edit, commit and push without asking.',
}

function dependencyLine(state: DependencyInstallState): string {
  if (state === 'failed') return 'Installing dependencies in this worktree failed; builds and tests may fail until you install them.'
  return state
    ? 'Dependencies are installed in this worktree.'
    : 'Dependencies were not installed in this worktree; install them before building or running tests.'
}

function handoffBlock(): string[] {
  const fields = Object.values(HANDOFF_INSTRUCTION_FIELDS).map(f => `${f.key}: ${f.value}`)
  return ['```' + HANDOFF_INFO_STRING, ...fields, '```']
}

export function composeSurfaceInstructions(input: SurfaceInstructionsInput): string {
  const { branch, baseBranch } = input
  const hostName = REPOSITORY_HOST_NAMES[input.host]
  const { owner, repo } = input.repository
  const persona = input.personaName ? ` with the "${input.personaName}" persona` : ''

  const delivery = input.writeScope === 'read-only'
    ? ['- You cannot deliver code changes, so leave pull_request as none in the handoff.']
    : [
        `- When the work is ready, commit it on \`${branch}\`, push \`${branch}\` to origin, and open a pull request from \`${branch}\` into \`${baseBranch}\` on ${hostName}.`,
        '- Put the pull request URL in the handoff. If you cannot open it, push the branch and say so in follow_ups.',
      ]

  const issues = input.issueTrackerNote
    ? '- Issues are tracked with `bd`, which works from this directory and reads and writes the project\'s main issue list. Refer to issues by id.'
    : '- `bd` is not connected to the project\'s issues in this session; do not create or close issues.'

  const slack = input.holderKind === 'slack'
    ? [
        '',
        '## Slack',
        `- You can post a Block Kit message with the \`${claudeMcpToolRule(SLACK_POST_BLOCKS_TOOL)}\` tool. It posts only into the current thread.`,
        '- Prefer it over plain text for structured content such as tables, lists with sections or status summaries; use plain text for short replies.',
      ]
    : []

  return [
    '# Platform instructions',
    '',
    `${FRAMING[input.family]} You are the bot "${input.botName}"${persona}, running on ${BOT_FAMILY_NAMES[input.family]}.`,
    '',
    '## Workspace',
    `- You are in a git worktree on branch \`${branch}\`, cut from \`${baseBranch}\`. Stay on \`${branch}\`; never commit to \`${baseBranch}\` directly.`,
    `- The repository is ${owner}/${repo} on ${hostName} (${REPOSITORY_URLS[input.host](owner, repo)}).`,
    `- ${dependencyLine(input.dependenciesInstalled)}`,
    issues,
    '',
    '## Delivery',
    `- ${WRITE_SCOPE_LINES[input.writeScope]}`,
    ...delivery,
    '',
    '## Handoff',
    `End every turn with a fenced code block whose info string is \`${HANDOFF_INFO_STRING}\`, as the last thing in your message, with one \`key: value\` line per field:`,
    ...handoffBlock(),
    `- outcome is one of ${HANDOFF_OUTCOMES.join(', ')}; partial means work remains, blocked means you need someone else to continue.`,
    '- Write none for a field with nothing to report.',
    ...slack,
  ].join('\n')
}

export function surfaceInstructionsForBot(deps: BotDeps, bot: Bot, runtime: BotSessionRuntime): string {
  const instance = resolvePluginInstance(deps, bot.projectId, 'repository')
  if (!instance) throw new BotError('repository_not_configured', 'Set up the Repository plugin for this project before starting a bot session')
  const baseBranch = runtime.baseBranch ?? bot.effectiveBaseBranch
  if (!baseBranch) throw new BotError('repository_not_configured', `The base branch for "${bot.name}" is unknown because the repository's default branch could not be read`)
  const config = repositoryConfig(instance.config)
  return composeSurfaceInstructions({
    family: bot.family,
    botName: bot.name,
    personaName: bot.persona.name,
    branch: runtime.branch,
    baseBranch,
    host: config.host,
    repository: { owner: config.owner, repo: config.repo },
    writeScope: bot.writeScope,
    dependenciesInstalled: runtime.dependenciesInstalled,
    issueTrackerNote: runtime.issueTrackerNote,
    holderKind: runtime.holderKind,
  })
}
