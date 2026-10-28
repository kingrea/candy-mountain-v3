import type { Bot, BotSlackConnection, PluginInstance } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import {
  botsFamilyOptions,
  botsFamilyPluginReason,
  botsPersonaFileRows,
  botsRepositoryDefaultBranch,
  botsSlackView,
  botsStatusView,
  type BotsPersonaCheck,
} from '../../app/utils/bots'

function instance(type: string, health: PluginInstance['health'], config: PluginInstance['config'] = {}): PluginInstance {
  return {
    id: `${type}-1`,
    type,
    scope: 'project',
    projectId: 'p1',
    projectSlug: 'acme',
    config,
    secrets: {},
    health,
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
  }
}

const healthy = { healthy: true, checkedAt: '2026-10-28T00:00:00Z' } as const
const READY = { 'claude-code': null, 'codex': null }
const ONLY_CLAUDE: BotsPersonaCheck = { personaName: 'ana', files: { branch: 'main', claudeCode: true, codex: false } }

describe('botsFamilyPluginReason', () => {
  it('matches the daemon wording for each plugin state', () => {
    expect(botsFamilyPluginReason([], 'codex')).toBe('The Codex plugin is not set up for this project')
    expect(botsFamilyPluginReason([instance('codex', null)], 'codex')).toBe('The Codex plugin has not been tested since it last changed')
    expect(botsFamilyPluginReason([instance('codex', { healthy: false, reason: 'Not logged in', checkedAt: 'x' })], 'codex'))
      .toBe('The Codex plugin is unhealthy: Not logged in')
    expect(botsFamilyPluginReason([instance('claude-code', healthy)], 'claude-code')).toBeNull()
  })
})

describe('botsFamilyOptions', () => {
  it('disables Codex with the missing file as the reason when only the Claude persona exists', () => {
    const options = botsFamilyOptions({ pluginReasons: READY, personaCheck: ONLY_CLAUDE })
    expect(options).toEqual([
      { value: 'claude-code', label: 'Claude Code', disabled: false },
      { value: 'codex', label: 'Codex', disabled: true, description: 'Codex persona file .agents/ana.md was not found on main' },
    ])
  })

  it('disables a family whose plugin is not healthy, except the saved bot\'s own family', () => {
    const pluginReasons = { 'claude-code': null, 'codex': 'The Codex plugin is unhealthy: Not logged in' }
    expect(botsFamilyOptions({ pluginReasons, personaCheck: null })[1]).toMatchObject({ disabled: true, description: pluginReasons.codex })
    expect(botsFamilyOptions({ pluginReasons, personaCheck: null, currentFamily: 'codex' })[1]).toMatchObject({ disabled: false, description: pluginReasons.codex })
  })

  it('still disables the saved family when its persona file is missing', () => {
    expect(botsFamilyOptions({ pluginReasons: READY, personaCheck: ONLY_CLAUDE, currentFamily: 'codex' })[1]?.disabled).toBe(true)
  })
})

describe('botsPersonaFileRows', () => {
  it('lists both families with their paths', () => {
    expect(botsPersonaFileRows(ONLY_CLAUDE)).toEqual([
      { family: 'claude-code', path: '.claude/agents/ana.md', found: true },
      { family: 'codex', path: '.agents/ana.md', found: false },
    ])
  })
})

describe('botsStatusView', () => {
  it('maps each status', () => {
    expect(botsStatusView('active')).toMatchObject({ label: 'Active', color: 'success', warnings: [] })
    expect(botsStatusView('not_configured')).toMatchObject({ label: 'Not configured', color: 'neutral' })
    expect(botsStatusView({ warnings: ['Slack bot token is missing'] })).toMatchObject({ label: '1 warning', color: 'warning', warnings: ['Slack bot token is missing'] })
    expect(botsStatusView({ warnings: ['a', 'b'] }).label).toBe('2 warnings')
  })
})

describe('botsRepositoryDefaultBranch', () => {
  const bot = (baseBranch: string | null, effectiveBaseBranch: string | null) => ({ baseBranch, effectiveBaseBranch }) as Bot

  it('prefers the repository plugin\'s configured default, then a bot that follows the default', () => {
    expect(botsRepositoryDefaultBranch([], [instance('repository', healthy, { defaultBranch: 'trunk' })])).toBe('trunk')
    expect(botsRepositoryDefaultBranch([bot('dev', 'dev'), bot(null, 'main')], [instance('repository', healthy)])).toBe('main')
    expect(botsRepositoryDefaultBranch([bot('dev', 'dev')], [])).toBeNull()
  })
})

describe('botsSlackView', () => {
  const keyed = { secrets: { slackBotToken: 'set', slackAppToken: 'set' } } as Bot
  const keyless = { secrets: { slackBotToken: 'set', slackAppToken: 'unset' } } as Bot
  const connection = (patch: Partial<BotSlackConnection>): BotSlackConnection =>
    ({ state: 'connected', reason: null, reasonCode: null, since: '', retryAt: null, identity: null, ...patch })

  it('is not configured when a key is unset or the daemon says keys are missing', () => {
    expect(botsSlackView(keyless, connection({}))?.label).toBe('Not configured')
    expect(botsSlackView(keyed, connection({ state: 'disconnected', reasonCode: 'missing_keys' }))?.label).toBe('Not configured')
  })

  it('shows the identity when connected and the reason when disconnected', () => {
    const identity = { teamId: 'T1', team: 'Acme', userId: 'U1', user: 'ana' }
    expect(botsSlackView(keyed, connection({ identity }))).toMatchObject({ label: 'Connected', detail: 'ana in Acme' })
    expect(botsSlackView(keyed, connection({ state: 'disconnected', reason: 'invalid_auth' }))).toMatchObject({ label: 'Disconnected', detail: 'invalid_auth' })
    expect(botsSlackView(keyed, connection({ state: 'connecting' }))?.label).toBe('Connecting')
  })

  it('renders nothing until the first response', () => {
    expect(botsSlackView(keyed, null)).toBeNull()
  })
})
