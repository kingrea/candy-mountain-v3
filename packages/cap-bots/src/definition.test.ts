import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WORKSPACES_PATH, type ApiErrorBody } from '@crab-shack/platform-sdk'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityDefinitionError, findWorkspaceBySlug, THREAD_SESSIONS } from '@crab-shack/platform-daemon'
import { createTempDataDir, fixtureDefinition, startTestPlatform, testKit, type TempDataDir, type TestKit, type TestKitOptions, type TestPlatformOptions } from '@crab-shack/platform-daemon/testing'
import { ACP_SESSIONS, acpDefinition } from '@candy-mountain/cap-acp'
import { fakeBins } from '@candy-mountain/testing'
import { claudeCodeDefinition } from '@candy-mountain/plugin-claude-code'
import { bots, worktreeLeases } from './schema'
import { codexPluginType } from '@candy-mountain/plugin-codex'
import { botsTestProduct } from './test-support'
import { SLACK_CONNECTIONS, slackDefinition } from '@candy-mountain/plugin-slack'
import { teamDefinition } from '@candy-mountain/cap-team'
import { repositoryDefinition, setRepository } from '@candy-mountain/plugin-repository'
import { botSecretOwner } from './bots'
import { createTempGitRepo } from './worktrees/test-repo'
import { BOT_SESSIONS, BOT_SLACK_DECISIONS, BOT_SLACK_HANDOFFS, BOT_SLACK_ROUTER, BOT_WORKTREE_RECLAIMER, BOT_WORKTREES, botsDefinition } from './definition'

const acp = { bins: fakeBins, killTimeoutMs: 1000 }

describe('the bots definition', () => {
  let temp: TempDataDir | undefined
  let kit: TestKit | undefined

  afterEach(async () => {
    await kit?.close()
    kit = undefined
    temp?.cleanup()
    temp = undefined
    vi.restoreAllMocks()
  })

  function start(options: TestKitOptions = {}) {
    kit = testKit(options)
    return { kit, platform: kit.platform, app: kit.admin }
  }

  const withAcp = (): TestKitOptions => ({ product: botsTestProduct({ acp }) })

  it('offers the bot session service, its workspace agents, the worktree pool and Slack routing, started after acp, claude-code, slack and team', () => {
    const { platform } = start(withAcp())

    const botSessions = platform.runtime.service(BOT_SESSIONS)
    expect(botSessions).toBeDefined()
    expect(platform.runtime.workspaceAgents.map(contribution => contribution.capabilityId)).toEqual(['bots'])
    expect(platform.runtime.services('bots').has(BOT_WORKTREES)).toBe(true)
    expect(platform.runtime.services('bots').has(BOT_WORKTREE_RECLAIMER)).toBe(true)
    expect(platform.runtime.started.map(s => s.definition.id)).toEqual(['threads', 'overview', 'repository', 'slack', 'acp', 'claude-code', 'codex', 'team', 'bots', 'chat-claude-code'])
    for (const key of [BOT_SLACK_ROUTER, BOT_SLACK_DECISIONS, BOT_SLACK_HANDOFFS]) expect(platform.runtime.services('bots').has(key), key.name).toBe(true)
  })

  it('mounts the bot, bot session and bot Slack status routes under the workspace prefix', async () => {
    const { app } = start(withAcp())

    for (const [path, method] of [['bots', 'GET'], ['bots/b1', 'GET'], ['bots/b1/sessions', 'POST'], ['bots/b1/slack', 'GET']] as const) {
      const res = await app.request(`${WORKSPACES_PATH}/nope/${path}`, { method })
      expect(res.status, path).toBe(404)
      expect(((await res.json()) as ApiErrorBody).error.code, path).toBe('not_found')
    }
  })

  it('removes a deleted project\'s bots, their secrets, its worktree leases and, once committed, its worktree directories', async () => {
    const { kit, platform, app } = start(withAcp())
    const repo = createTempGitRepo()
    try {
      const project = kit.workspace({ name: 'alpha', slug: 'alpha' })
      await setRepository(platform.db, project.id, { kind: 'local-path', path: repo.clone })
      const now = new Date().toISOString()
      const botId = randomUUID()
      platform.db.insert(bots).values({ id: botId, projectId: project.id, name: 'Ana', family: 'claude-code', writeScope: 'read-only', answersIn: { anywhere: true }, createdAt: now, updatedAt: now }).run()
      platform.secrets.set(botSecretOwner(botId), 'slackBotToken', 'xoxb-secret')
      const worktrees = platform.runtime.services('bots').get(BOT_WORKTREES)
      const lease = await worktrees.acquire({ projectId: project.id, holder: { kind: 'session', id: 's1' }, baseBranch: 'main', installDependencies: false })
      writeFileSync(join(lease.path, 'unsaved.txt'), 'gone with the project\n')

      expect((await app.request(`${WORKSPACES_PATH}/alpha`, { method: 'DELETE' })).status).toBe(204)
      expect(findWorkspaceBySlug(platform.db, 'alpha')).toBeNull()
      expect(platform.db.select().from(bots).where(eq(bots.projectId, project.id)).all()).toEqual([])
      expect(platform.secrets.isSet(botSecretOwner(botId), 'slackBotToken')).toBe(false)
      expect(worktrees.list(project.id, { includeReleased: true })).toEqual([])
      expect(platform.db.select().from(worktreeLeases).where(eq(worktreeLeases.projectId, project.id)).all()).toEqual([])
      expect(existsSync(join(platform.paths.worktrees, project.id))).toBe(false)
      expect(repo.git(repo.clone, 'worktree', 'list', '--porcelain')).not.toContain(lease.path)
      expect(repo.git(repo.clone, 'branch', '--list', lease.branch)).toContain(lease.branch)
    }
    finally {
      repo.cleanup()
    }
  })

  it('closes Slack routing, then bot sessions and the reclaimer, before acp closes its sessions and slack its connections', async () => {
    const { kit, platform } = start(withAcp())
    const bots = platform.runtime.services('bots')
    const botSessions = bots.get(BOT_SESSIONS)
    const reclaimer = bots.get(BOT_WORKTREE_RECLAIMER)
    const sessions = platform.runtime.services('acp').get(ACP_SESSIONS)
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

    await kit.close()
    expect(order).toEqual(['router', 'decisions', 'handoffs', 'bot sessions', 'reclaimer', 'sessions', 'connections'])
  })

  it('boots without bots: their routes answer not found, nothing offers bot sessions, threads are still served and Slack routing stays off', async () => {
    // Team requires the hasBots fact bots declares, so a product without bots leaves team out too.
    const { platform, app } = start({ product: botsTestProduct({ acp }, ['bots', 'team']) })

    expect(platform.runtime.started.map(s => s.definition.id)).toEqual(['threads', 'overview', 'repository', 'slack', 'acp', 'claude-code', 'chat-claude-code', 'codex'])
    expect(platform.runtime.service(BOT_SESSIONS)).toBeUndefined()
    expect(platform.runtime.workspaceAgents).toEqual([])
    expect(platform.runtime.service(THREAD_SESSIONS)).toBeDefined()
    expect(platform.runtime.service(BOT_SLACK_ROUTER)).toBeUndefined()
    for (const [path, method] of [['bots', 'GET'], ['bots/b1/sessions', 'POST'], ['bots/b1/slack', 'GET']] as const) {
      const res = await app.request(`${WORKSPACES_PATH}/nope/${path}`, { method })
      expect(res.status, path).toBe(404)
      expect(await res.text(), path).toBe('404 Not Found')
    }
    const threads = await app.request(`${WORKSPACES_PATH}/nope/threads`)
    expect(threads.status).toBe(404)
    expect(((await threads.json()) as ApiErrorBody).error.code).toBe('not_found')
    expect((await app.request(WORKSPACES_PATH)).status).toBe(200)
  })

  it('refuses a list with bots but without claude-code, naming both, and touches nothing on disk', () => {
    temp = createTempDataDir()
    // The chat-claude-code stand-in needs claude-code too, so it leaves with it.
    const options: TestPlatformOptions = { product: botsTestProduct({}, ['claude-code', 'chat-claude-code']) }
    expect(() => startTestPlatform(temp!.root, options)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp!.root, options)).toThrow("Capability 'bots' depends on 'claude-code', which is not in the definition list.")
    expect(existsSync(temp!.root)).toBe(false)
  })

  it('refuses a list with bots but without slack, naming both, and touches nothing on disk', () => {
    temp = createTempDataDir()
    const options: TestPlatformOptions = { product: botsTestProduct({}, ['slack']) }
    expect(() => startTestPlatform(temp!.root, options)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp!.root, options)).toThrow("Capability 'bots' depends on 'slack', which is not in the definition list.")
    expect(existsSync(temp!.root)).toBe(false)
  })

  it('refuses to start when a bot family is not a registered session family', () => {
    temp = createTempDataDir()
    // A stand-in codex that brings no codex family, so the dependency is met but the family is not.
    const codex = fixtureDefinition('codex', { manifest: null, dependsOn: ['acp'] })
    const options: TestPlatformOptions = { capabilities: [repositoryDefinition(), acpDefinition({ acp }), claudeCodeDefinition(), codex, slackDefinition(), teamDefinition(), botsDefinition()], modules: [], pluginTypes: [codexPluginType], families: [{ id: 'platform', name: 'Platform agent' }] }
    expect(() => startTestPlatform(temp!.root, options)).toThrow(CapabilityDefinitionError)
    expect(() => startTestPlatform(temp!.root, options)).toThrow("Capability 'bots': bot family 'codex' is not a registered session family.")
  })
})
