import { describe, expect, it } from 'vitest'
import { computeBotStatus, type BotStatusInput } from './status'

const ready: BotStatusInput = {
  family: 'claude-code',
  familyPlugin: { health: { healthy: true, checkedAt: '2026-10-28T00:00:00.000Z' } },
  persona: { name: 'ana', status: 'verified', reason: null },
  secrets: { slackBotToken: 'set', slackAppToken: 'set' },
  baseBranchProblem: null,
}
const status = (overrides: Partial<BotStatusInput>) => computeBotStatus({ ...ready, ...overrides })

describe('computeBotStatus', () => {
  it('is active when the plugin is healthy, the persona verified and both Slack keys set', () => {
    expect(status({})).toBe('active')
  })

  it('is not configured when no Slack key is set and the persona is unverified', () => {
    expect(status({ secrets: { slackBotToken: 'unset', slackAppToken: 'unset' }, persona: { name: 'ana', status: 'unverified', reason: null } })).toBe('not_configured')
    expect(status({ secrets: { slackBotToken: 'unset', slackAppToken: 'unset' }, persona: { name: null, status: 'unverified', reason: null }, familyPlugin: null })).toBe('not_configured')
  })

  it('names each missing Slack key', () => {
    expect(status({ secrets: { slackBotToken: 'set', slackAppToken: 'unset' } })).toEqual({ warnings: ['Slack app-level token is missing'] })
    expect(status({ secrets: { slackBotToken: 'unset', slackAppToken: 'set' } })).toEqual({ warnings: ['Slack bot token is missing'] })
    expect(status({ secrets: { slackBotToken: 'unset', slackAppToken: 'unset' } })).toEqual({ warnings: ['Slack bot token is missing', 'Slack app-level token is missing'] })
  })

  it('warns about the family plugin being missing, untested or unhealthy', () => {
    expect(status({ family: 'codex', familyPlugin: null })).toEqual({ warnings: ['The Codex plugin is not set up for this project'] })
    expect(status({ familyPlugin: { health: null } })).toEqual({ warnings: ['The Claude Code plugin has not been tested since it last changed'] })
    expect(status({ familyPlugin: { health: { healthy: false, reason: 'Not logged in.', checkedAt: 'x' } } })).toEqual({ warnings: ['The Claude Code plugin is unhealthy: Not logged in.'] })
  })

  it('warns about a missing, unchecked or not found persona', () => {
    expect(status({ persona: { name: null, status: 'unverified', reason: null } })).toEqual({ warnings: ['No persona is set'] })
    expect(status({ persona: { name: 'ana', status: 'unverified', reason: null } })).toEqual({ warnings: ['Persona "ana" has not been checked'] })
    expect(status({ persona: { name: 'ana', status: 'missing', reason: '.agents/ana.md is not on main' } })).toEqual({ warnings: ['.agents/ana.md is not on main'] })
    expect(status({ persona: { name: 'ana', status: 'missing', reason: null } })).toEqual({ warnings: ['Persona "ana" was not found on the base branch'] })
  })

  it('warns when a blank base branch cannot be resolved', () => {
    expect(status({ baseBranchProblem: 'Cannot read the default branch' })).toEqual({ warnings: ['Cannot read the default branch'] })
  })

  it('lists every reason together, in a stable order', () => {
    expect(status({
      familyPlugin: { health: null },
      persona: { name: 'ana', status: 'unverified', reason: null },
      secrets: { slackBotToken: 'set', slackAppToken: 'unset' },
    })).toEqual({ warnings: ['The Claude Code plugin has not been tested since it last changed', 'Persona "ana" has not been checked', 'Slack app-level token is missing'] })
  })
})
