import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECTS_PATH, type ApiErrorBody } from '@candy-mountain/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeBins } from '../acp/test-support'
import { CapabilityDefinitionError } from '../capabilities/definition'
import { fixtureDefinition } from '../capabilities/fixtures'
import { ACP_SESSIONS, chatClaudeCodeDefinition } from '../chat-claude-code/definition'
import { bots, worktreeLeases } from '../db/schema'
import { capabilityDefinitions } from '../definitions'
import { codexPluginType, PLUGIN_TYPES } from '../plugins'
import type { Platform } from '../platform'
import { createTestApp, startTestPlatform, withoutCapabilities, type TestPlatformOptions } from '../testing/platform'
import { createProject, findProjectBySlug } from '../projects/projects'
import { MasterKey } from '../secrets'
import { SLACK_CONNECTIONS, slackDefinition } from '../slack/definition'
import { createTempDataDir, type TempDataDir } from '../testing'
import { THREAD_BOTS } from '../threads/bots'
import { THREAD_SESSIONS } from '../threads/sessions'
import { botSecretOwner } from './bots'
import { BOT_SESSIONS, BOT_SLACK_DECISIONS, BOT_SLACK_HANDOFFS, BOT_SLACK_ROUTER, BOT_WORKTREE_RECLAIMER, BOT_WORKTREES, botsDefinition } from './definition'

const acp = { bins: fakeBins, killTimeoutMs: 1000 }

describe('the bots definition', () => {
  let temp: TempDataDir
  const open: Platform[] = []

  afterEach(async () => {
    for (const platform of open.splice(0)) await platform.close()
    temp?.cleanup()
    vi.restoreAllMocks()
  })

  function start(options: TestPlatformOptions = {}) {
    temp = createTempDataDir()
    const platform = startTestPlatform(temp.root, options)
    open.push(platform)
    const app = createTestApp({ db: platform.db, paths: platform.paths, capabilities: platform.capabilities, modules: platform.modules, pluginTypes: platform.pluginTypes, families: platform.families, secrets: platform.secrets.writeOnly, secretsReader: platform.secrets, runtime: platform.runtime })
    return { platform, app }
  }

  const withAcp = (): TestPlatformOptions => ({ capabilities: capabilityDefinitions({ chatClaudeCode: { acp } }) })

  it('offers the bot session service, the thread-facing key, the worktree pool and Slack routing, started after chat-claude-code and slack', () => {
    const { platform } = start(withAcp())

    const botSessions = platform.runtime.service(BOT_SESSIONS)
    expect(botSessions).toBeDefined()
    expect(platform.runtime.service(THREAD_BOTS)).toBe(botSessions)
    expect(platform.runtime.services('bots').has(BOT_WORKTREES)).toBe(true)
    expect(platform.runtime.services('bots').has(BOT_WORKTREE_RECLAIMER)).toBe(true)
    expect(platform.runtime.started.map(s => s.definition.id)).toEqual(['threads', 'overview', 'issues', 'slack', 'chat-claude-code', 'chat-codex', 'bots', 'team', 'uptime', 'deployments', 'platform-agent'])
    for (const key of [BOT_SLACK_ROUTER, BOT_SLACK_DECISIONS, BOT_SLACK_HANDOFFS]) expect(platform.runtime.services('bots').has(key), key.name).toBe(true)
  })

  it('mounts the bot, bot session and bot Slack status routes under the workspace prefix', async () => {
    const { app } = start(withAcp())

    for (const [path, method] of [['bots', 'GET'], ['bots/b1', 'GET'], ['bots/b1/sessions', 'POST'], ['bots/b1/slack', 'GET']] as const) {
      const res = await app.request(`${PROJECTS_PATH}/nope/${path}`, { method })
      expect(res.status, path).toBe(404)
      expect(((await res.json()) as ApiErrorBody).error.code, path).toBe('not_found')
    }
  })

  it('removes a deleted project\'s bots, their secrets and its worktree leases through the deletion hook', async () => {
    const { platform, app } = start({ ...withAcp(), secretsKey: MasterKey.generate() })
    const checkout = mkdtempSync(join(tmpdir(), 'candy-mountain-bots-'))
    try {
      const project = await createProject(platform.db, { name: 'alpha', source: { kind: 'local-path', path: checkout } })
      const now = new Date().toISOString()
      const botId = randomUUID()
      platform.db.insert(bots).values({ id: botId, projectId: project.id, name: 'Ana', family: 'claude-code', writeScope: 'read-only', answersIn: { anywhere: true }, createdAt: now, updatedAt: now }).run()
      platform.secrets.set(botSecretOwner(botId), 'slackBotToken', 'xoxb-secret')
      platform.db.insert(worktreeLeases).values({ id: randomUUID(), projectId: project.id, holderKind: 'session', holderId: 's1', path: join(checkout, 'wt'), branch: 'cm/bot/ana/s1', baseBranch: 'main', createdAt: now, updatedAt: now, lastUsedAt: now }).run()

      expect((await app.request(`${PROJECTS_PATH}/alpha`, { method: 'DELETE' })).status).toBe(204)
      expect(findProjectBySlug(platform.db, 'alpha')).toBeNull()
      expect(platform.db.select().from(bots).where(eq(bots.projectId, project.id)).all()).toEqual([])
      expect(platform.secrets.isSet(botSecretOwner(botId), 'slackBotToken')).toBe(false)
      expect(platform.runtime.services('bots').get(BOT_WORKTREES).list(project.id)).toEqual([])
      expect(platform.db.select().from(worktreeLeases).where(eq(worktreeLeases.projectId, project.id)).all()).toEqual([])
    }
    finally {
      rmSync(checkout, { recursive: true, force: true })
    }
  })

  it('closes Slack routing, then bot sessions and the reclaimer, before chat-claude-code closes its sessions and slack its connections', async () => {
    const { platform } = start(withAcp())
    const bots = platform.runtime.services('bots')
    const botSessions = bots.get(BOT_SESSIONS)
    const reclaimer = bots.get(BOT_WORKTREE_RECLAIMER)
    const sessions = platform.runtime.services('chat-claude-code').get(ACP_SESSIONS)
    const connections = platform.runtime.services('slack').get(SLACK_CONNECTIONS)
    const order: string[] = []
    const record = <T extends object, K extends keyof T & string>(target: T, method: K, name: string) => {
      const original = (target[method] as unknown as (...args: unknown[]) => unknown).bind(target)
      vi.spyOn(target, method as never).mockImplementation(((...args: unknown[]) => {
        order.push(name)
        return original(...args)
      }) as never)
    }
    record(bots.get(BOT_SLACK_ROUTER), 'close', 'router')
    record(bots.get(BOT_SLACK_DECISIONS), 'close', 'decisions')
    record(bots.get(BOT_SLACK_HANDOFFS), 'close', 'handoffs')
    record(botSessions, 'stop', 'bot sessions')
    record(reclaimer, 'close', 'reclaimer')
    record(sessions, 'close', 'sessions')
    record(connections, 'close', 'connections')

    await platform.close()
    expect(order).toEqual(['router', 'decisions', 'handoffs', 'bot sessions', 'reclaimer', 'sessions', 'connections'])
  })

  it('boots without bots: their routes answer not found, nothing offers bot sessions, threads are still served and Slack routing stays off', async () => {
    const { platform, app } = start({ ...withoutCapabilities('bots'), capabilities: capabilityDefinitions({ chatClaudeCode: { acp } }).filter(c => c.id !== 'bots') })

    expect(platform.runtime.started.map(s => s.definition.id)).toEqual(['threads', 'overview', 'issues', 'slack', 'team', 'chat-claude-code', 'chat-codex', 'uptime', 'deployments', 'platform-agent'])
    expect(platform.runtime.service(BOT_SESSIONS)).toBeUndefined()
    expect(platform.runtime.service(THREAD_BOTS)).toBeUndefined()
    expect(platform.runtime.service(THREAD_SESSIONS)).toBeDefined()
    expect(platform.runtime.service(BOT_SLACK_ROUTER)).toBeUndefined()
    for (const [path, method] of [['bots', 'GET'], ['bots/b1/sessions', 'POST'], ['bots/b1/slack', 'GET']] as const) {
      const res = await app.request(`${PROJECTS_PATH}/nope/${path}`, { method })
      expect(res.status, path).toBe(404)
      expect(await res.text(), path).toBe('404 Not Found')
    }
    const threads = await app.request(`${PROJECTS_PATH}/nope/threads`)
    expect(threads.status).toBe(404)
    expect(((await threads.json()) as ApiErrorBody).error.code).toBe('not_found')
    expect((await app.request(PROJECTS_PATH)).status).toBe(200)
  })

  it('refuses a list with bots but without chat-claude-code, naming both, and touches nothing on disk', () => {
    temp = createTempDataDir()
    const options = withoutCapabilities('chat-claude-code')
    expect(() => startTestPlatform(temp.root, options)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp.root, options)).toThrow("Capability 'bots' depends on 'chat-claude-code', which is not in the definition list.")
    expect(existsSync(temp.root)).toBe(false)
  })

  it('refuses a list with bots but without slack, naming both, and touches nothing on disk', () => {
    temp = createTempDataDir()
    const options = withoutCapabilities('slack')
    expect(() => startTestPlatform(temp.root, options)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp.root, options)).toThrow("Capability 'bots' depends on 'slack', which is not in the definition list.")
    expect(existsSync(temp.root)).toBe(false)
  })

  it('refuses to start when a bot family is not a registered session family', () => {
    temp = createTempDataDir()
    // A stand-in chat-codex that brings no codex family, so the dependency is met but the family is not.
    const chatCodex = fixtureDefinition('chat-codex', { manifest: null, dependsOn: ['chat-claude-code'] })
    const options: TestPlatformOptions = { capabilities: [chatClaudeCodeDefinition({ acp }), chatCodex, slackDefinition(), botsDefinition()], modules: [], pluginTypes: [...PLUGIN_TYPES, codexPluginType], families: [{ id: 'platform', name: 'Platform agent' }] }
    expect(() => startTestPlatform(temp.root, options)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp.root, options)).toThrow("Capability 'bots': bot family 'codex' is not a registered session family.")
  })
})
