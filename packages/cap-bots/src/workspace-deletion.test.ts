import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WORKSPACES_PATH, type Workspace } from '@crab-shack/platform-sdk'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { bots } from './schema'
import { botSecretOwner } from './bots/bots'
import { slackDecisionMetaKey } from './slack/meta'
import { botsKit, type BotsKit } from './test-support'

let kit: BotsKit | undefined

afterEach(async () => {
  await kit?.close()
  kit = undefined
})

function seed(workspace: Workspace) {
  const { platform } = kit!
  const botId = randomUUID()
  const at = new Date().toISOString()
  platform.db.insert(bots).values({
    id: botId, projectId: workspace.id, name: `bot-${botId.slice(0, 8)}`, family: 'claude-code', writeScope: 'read-only', baseBranch: 'main',
    personaName: 'ana', answersIn: { anywhere: true }, personaStatus: 'verified', createdAt: at, updatedAt: at,
  }).run()
  platform.secrets.set(botSecretOwner(botId), 'slackBotToken', 'xoxb-kept')
  const decisionKey = slackDecisionMetaKey(randomUUID())
  platform.db.run(sql`INSERT INTO platform_meta (key, value, updated_at) VALUES (${decisionKey}, ${JSON.stringify({ botId, channel: 'C1', ts: '1.1' })}, '2026-01-01T00:00:00.000Z')`)
  const worktrees = join(platform.paths.worktrees, workspace.id)
  mkdirSync(join(worktrees, 'lease'), { recursive: true })
  writeFileSync(join(worktrees, 'lease', 'work.txt'), 'uncommitted\n')
  return { botId, decisionKey, worktrees }
}

const metaRows = (decisionKey: string) => kit!.platform.db.all<{ key: string }>(sql`SELECT key FROM platform_meta WHERE key = ${decisionKey}`).length

describe('deleting a workspace with bots', () => {
  it('removes its bots, their secrets, their Slack decision rows and their worktrees, and keeps every other workspace\'s', async () => {
    kit = botsKit()
    const doomed = kit.workspace({ name: 'Doomed', slug: 'doomed' })
    const kept = kit.workspace({ name: 'Kept', slug: 'kept' })
    const gone = seed(doomed)
    const left = seed(kept)

    expect((await kit.admin.request(`${WORKSPACES_PATH}/${doomed.slug}`, { method: 'DELETE' })).status).toBe(204)

    const botIds = kit.platform.db.select({ id: bots.id }).from(bots).all().map(b => b.id)
    expect(botIds).toEqual([left.botId])
    expect(kit.platform.secrets.isSet(botSecretOwner(gone.botId), 'slackBotToken')).toBe(false)
    expect(kit.platform.secrets.isSet(botSecretOwner(left.botId), 'slackBotToken')).toBe(true)
    expect(metaRows(gone.decisionKey)).toBe(0)
    expect(metaRows(left.decisionKey)).toBe(1)
    expect(existsSync(gone.worktrees)).toBe(false)
    expect(existsSync(left.worktrees)).toBe(true)
  })
})
