import { BOT_FAMILIES, parseHandoff, type Bot } from '@candy-mountain/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { createPluginInstance } from '../plugins/instances/instances'
import { instanceHarness, type InstanceHarness } from '../plugins/instances/test-support'
import { repositoryPluginType } from '../plugins/types/repository'
import { BotError } from './errors'
import { composeSurfaceInstructions, HANDOFF_INFO_STRING, HANDOFF_INSTRUCTION_FIELDS, surfaceInstructionsForBot, type SurfaceInstructionsInput } from './instructions'

const base: SurfaceInstructionsInput = {
  family: 'claude-code',
  botName: 'Ana',
  personaName: 'ana',
  branch: 'cm/ana/7f3a',
  baseBranch: 'develop',
  host: 'github',
  repository: { owner: 'jack', repo: 'candy' },
  writeScope: 'write-confirm',
  dependenciesInstalled: true,
  issueTrackerNote: true,
}

const compose = (overrides: Partial<SurfaceInstructionsInput> = {}) => composeSurfaceInstructions({ ...base, ...overrides })

const SAMPLE = {
  outcome: 'partial',
  summary: 'Fixed the login redirect; the logout path still loops',
  pullRequest: 'https://github.com/jack/candy/pull/42',
  issues: 'cm-12, cm-14',
  followUps: 'Check logout on Safari; add a redirect test',
} satisfies Record<keyof typeof HANDOFF_INSTRUCTION_FIELDS, string>

/** Fills the template the instructions show, so the parser reads exactly the keys the bot is told to write. */
function filledTemplate(text: string): string {
  const lines = text.split('\n')
  const start = lines.indexOf('```' + HANDOFF_INFO_STRING)
  const end = lines.indexOf('```', start + 1)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const byKey = new Map(Object.entries(HANDOFF_INSTRUCTION_FIELDS).map(([field, { key }]) => [key, SAMPLE[field as keyof typeof SAMPLE]]))
  const body = lines.slice(start + 1, end).map((line) => {
    const key = line.slice(0, line.indexOf(':'))
    expect(byKey.has(key), `template line "${line}"`).toBe(true)
    return `${key}: ${byKey.get(key)}`
  })
  return [lines[start], ...body, lines[end]].join('\n')
}

describe('composeSurfaceInstructions', () => {
  it.each(BOT_FAMILIES)('tells a %s bot its branch, base branch, host, issue tracker, dependencies and handoff', (family) => {
    const text = compose({ family })
    expect(text).toContain('`cm/ana/7f3a`')
    expect(text).toContain('into `develop` on GitHub')
    expect(text).toContain('https://github.com/jack/candy')
    expect(text).toContain('`bd`, which works from this directory')
    expect(text).toContain('main issue list')
    expect(text).toContain('Dependencies are installed in this worktree.')
    expect(text).toContain('End every turn with a fenced code block whose info string is `handoff`')
    expect(text).toContain('outcome: <done|partial|blocked>')
    expect(text).toContain('Ana')
    expect(text).toContain('"ana" persona')
    expect(text.split('\n').length).toBeLessThan(40)
  })

  it('frames the text as system-level for Claude Code and as developer instructions for Codex', () => {
    expect(compose({ family: 'claude-code' })).toContain('These system-level instructions')
    expect(compose({ family: 'claude-code' })).toContain('running on Claude Code')
    expect(compose({ family: 'codex' })).toContain('These developer instructions')
    expect(compose({ family: 'codex' })).not.toContain('system-level')
  })

  it('names Bitbucket and its URL', () => {
    const text = compose({ host: 'bitbucket', repository: { owner: 'team', repo: 'shop' } })
    expect(text).toContain('on Bitbucket')
    expect(text).toContain('https://bitbucket.org/team/shop')
    expect(text).not.toContain('GitHub')
  })

  it('reports each dependency state', () => {
    expect(compose({ dependenciesInstalled: false })).toContain('Dependencies were not installed')
    expect(compose({ dependenciesInstalled: 'failed' })).toContain('Installing dependencies in this worktree failed')
  })

  it('says bd is not connected when the issue tracker note is off', () => {
    const text = compose({ issueTrackerNote: false })
    expect(text).toContain('`bd` is not connected')
    expect(text).not.toContain('main issue list')
  })

  it('tells a read-only bot not to push or open a pull request', () => {
    const text = compose({ writeScope: 'read-only' })
    expect(text).toContain('read-only')
    expect(text).toContain('leave pull_request as none')
    expect(text).not.toContain('open a pull request')
    expect(compose({ writeScope: 'write-auto' })).toContain('without asking')
  })

  it('omits the persona clause when the bot has none', () => {
    expect(compose({ personaName: null })).toContain('You are the bot "Ana", running on')
  })

  it.each(BOT_FAMILIES)('produces a %s handoff template that parseHandoff reads back when filled in and appended to a reply', (family) => {
    const reply = `Done for now.\n\n${filledTemplate(compose({ family }))}\n`
    expect(parseHandoff(reply)).toEqual({
      ok: true,
      handoff: {
        outcome: 'partial',
        summary: SAMPLE.summary,
        pullRequest: SAMPLE.pullRequest,
        issues: ['cm-12', 'cm-14'],
        followUps: ['Check logout on Safari', 'add a redirect test'],
      },
    })
  })

  it('round-trips a composed message with a sample block appended', () => {
    const block = ['```handoff', 'outcome: done', 'summary: Merged nothing', 'pull_request: none', 'issues: none', 'follow_ups: none', '```'].join('\n')
    const result = parseHandoff(`${compose()}\n\n${block}`)
    expect(result).toEqual({ ok: true, handoff: { outcome: 'done', summary: 'Merged nothing', pullRequest: null, issues: [], followUps: [] } })
  })
})

describe('Slack tool mention', () => {
  it('names post_blocks only for a Slack holder', () => {
    expect(compose({ holderKind: 'slack' })).toContain('`mcp__candy_mountain_slack__post_blocks`')
    expect(compose({ holderKind: 'console' })).not.toContain('post_blocks')
    expect(compose()).not.toContain('post_blocks')
  })
})

describe('surfaceInstructionsForBot', () => {
  let h: InstanceHarness
  afterEach(() => h?.close())

  const bot = (projectId: string, overrides: Partial<Bot> = {}): Bot => ({
    id: 'b1',
    projectId,
    name: 'Ana',
    family: 'codex',
    writeScope: 'write-auto',
    baseBranch: null,
    effectiveBaseBranch: 'main',
    persona: { name: 'ana', status: 'verified', checkedAt: null, reason: null },
    answersIn: { anywhere: true },
    secrets: { slackBotToken: 'set', slackAppToken: 'set' },
    status: 'active',
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z',
    ...overrides,
  })

  async function project(repository: boolean) {
    h = instanceHarness([repositoryPluginType])
    const p = await h.createProject('alpha')
    if (repository) {
      createPluginInstance(h.deps, { type: 'repository', scope: 'project', projectId: p.id, config: { host: 'bitbucket', owner: 'team', repo: 'shop' }, secrets: { token: 't' } })
    }
    return p
  }

  it('fills the input from the bot and the Repository plugin config', async () => {
    const p = await project(true)
    const runtime = { branch: 'cm/ana/1', dependenciesInstalled: 'failed', issueTrackerNote: true } as const
    expect(surfaceInstructionsForBot(h.deps, bot(p.id), runtime)).toBe(composeSurfaceInstructions({
      family: 'codex',
      botName: 'Ana',
      personaName: 'ana',
      branch: 'cm/ana/1',
      baseBranch: 'main',
      host: 'bitbucket',
      repository: { owner: 'team', repo: 'shop' },
      writeScope: 'write-auto',
      dependenciesInstalled: 'failed',
      issueTrackerNote: true,
    }))
    expect(surfaceInstructionsForBot(h.deps, bot(p.id), { ...runtime, baseBranch: 'release' })).toContain('into `release` on Bitbucket')
  })

  it('refuses without a Repository plugin or a known base branch', async () => {
    const bare = await project(false)
    const runtime = { branch: 'cm/ana/1', dependenciesInstalled: true, issueTrackerNote: true }
    expect(() => surfaceInstructionsForBot(h.deps, bot(bare.id), runtime)).toThrow(BotError)
    h.close()

    const p = await project(true)
    expect(() => surfaceInstructionsForBot(h.deps, bot(p.id, { effectiveBaseBranch: null }), runtime)).toThrow(/base branch/)
  })
})
