import type { ApiErrorBody, Workspace } from '@crab-shack/platform-sdk'
import type { TeamMember } from './wire'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { deleteWorkspace } from '@crab-shack/platform-daemon'
import { testKit, type TestKit } from '@crab-shack/platform-daemon/testing'
import { teamDefinition } from './definition'
import { projectBots } from './project-bots'
import { addTeamMember, listTeamMembers, mayMemberTalkToBot, removeTeamMember, touchMemberActivity } from './service'

let kit: TestKit
beforeEach(() => {
  kit = testKit({ capabilities: [teamDefinition()], facts: ['hasBots'] })
  // The bots capability owns this table; the scope check only reads id and project_id.
  kit.db.run(sql`CREATE TABLE bots (id text PRIMARY KEY, project_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE)`)
})
afterEach(() => kit.close())

const project = async (name: string): Promise<Workspace> => kit.workspace({ name, slug: name })

function botIn(projectId: string): string {
  const id = crypto.randomUUID()
  kit.db.insert(projectBots).values({ id, projectId }).run()
  return id
}

const viewer = () => kit.actor()
const call = (method: string, path: string, body?: unknown, as = kit.admin) =>
  as.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

const input = (slackMemberId: string, botScope: TeamMember['botScope']) => ({ displayName: 'Ana', slackMemberId, email: null, botScope })

describe('team service', () => {
  it('answers the lookup per bot and after removal', async () => {
    const alpha = await project('alpha')
    const [one, two] = [botIn(alpha.id), botIn(alpha.id)]
    const member = addTeamMember(kit.db, alpha.id, input('U111', { botIds: [one] }))
    expect(mayMemberTalkToBot(kit.db, alpha.id, 'U111', one)).toBe(true)
    expect(mayMemberTalkToBot(kit.db, alpha.id, 'U111', two)).toBe(false)
    expect(mayMemberTalkToBot(kit.db, alpha.id, 'U999', one)).toBe(false)
    addTeamMember(kit.db, alpha.id, input('U222', { all: true }))
    expect(mayMemberTalkToBot(kit.db, alpha.id, 'U222', two)).toBe(true)
    removeTeamMember(kit.db, alpha.id, member.id)
    expect(mayMemberTalkToBot(kit.db, alpha.id, 'U111', one)).toBe(false)
  })

  it('isolates projects, allows the same Slack id in two, and cascades', async () => {
    const [alpha, beta] = [await project('alpha'), await project('beta')]
    addTeamMember(kit.db, alpha.id, input('U111', { all: true }))
    addTeamMember(kit.db, beta.id, input('U111', { botIds: [] }))
    const betaBot = botIn(beta.id)
    expect(mayMemberTalkToBot(kit.db, alpha.id, 'U111', betaBot)).toBe(true)
    expect(mayMemberTalkToBot(kit.db, beta.id, 'U111', betaBot)).toBe(false)
    expect(listTeamMembers(kit.db, beta.id)).toHaveLength(1)
    deleteWorkspace(kit.db, 'alpha')
    expect(listTeamMembers(kit.db, alpha.id)).toEqual([])
    expect(listTeamMembers(kit.db, beta.id)).toHaveLength(1)
  })

  it('records last activity only for listed members', async () => {
    const alpha = await project('alpha')
    const member = addTeamMember(kit.db, alpha.id, input('U111', { all: true }))
    expect(member.lastActiveAt).toBeNull()
    expect(touchMemberActivity(kit.db, alpha.id, 'U111', new Date('2026-01-02T00:00:00Z'))).toBe(true)
    expect(touchMemberActivity(kit.db, alpha.id, 'U404')).toBe(false)
    expect(listTeamMembers(kit.db, alpha.id)[0]!.lastActiveAt).toBe('2026-01-02T00:00:00.000Z')
  })
})

describe('team routes', () => {
  it('adds, lists, updates and removes a member', async () => {
    const alpha = await project('alpha')
    const bot = botIn(alpha.id)
    const created = await call('POST', '/workspaces/alpha/team', { displayName: ' Ana ', slackMemberId: 'U111', email: 'ana@example.com', botScope: { botIds: [bot] } })
    expect(created.status).toBe(201)
    const { member } = await created.json() as { member: TeamMember }
    expect(member).toMatchObject({ displayName: 'Ana', email: 'ana@example.com', botScope: { botIds: [bot] }, lastActiveAt: null })
    expect(((await (await call('GET', '/workspaces/alpha/team')).json()) as { members: TeamMember[] }).members).toHaveLength(1)
    const patched = await call('PATCH', `/workspaces/alpha/team/${member.id}`, { botScope: { all: true }, email: null })
    expect(((await patched.json()) as { member: TeamMember }).member).toMatchObject({ botScope: { all: true }, email: null, displayName: 'Ana' })
    expect((await call('GET', `/workspaces/alpha/team/${member.id}`)).status).toBe(200)
    expect((await call('DELETE', `/workspaces/alpha/team/${member.id}`)).status).toBe(204)
    expect((await call('GET', `/workspaces/alpha/team/${member.id}`)).status).toBe(404)
    expect(mayMemberTalkToBot(kit.db, alpha.id, 'U111', bot)).toBe(false)
  })

  it('rejects a duplicate Slack id with 409, on create and on update', async () => {
    await project('alpha')
    await call('POST', '/workspaces/alpha/team', { displayName: 'Ana', slackMemberId: 'U111' })
    const dup = await call('POST', '/workspaces/alpha/team', { displayName: 'Ben', slackMemberId: 'U111' })
    expect(dup.status).toBe(409)
    expect(((await dup.json()) as ApiErrorBody).error.code).toBe('slack_member_taken')
    const ben = await (await call('POST', '/workspaces/alpha/team', { displayName: 'Ben', slackMemberId: 'U222' })).json() as { member: TeamMember }
    expect((await call('PATCH', `/workspaces/alpha/team/${ben.member.id}`, { slackMemberId: 'U111' })).status).toBe(409)
    expect((await call('PATCH', `/workspaces/alpha/team/${ben.member.id}`, { slackMemberId: 'U222' })).status).toBe(200)
  })

  it('validates bot ids against the project and the body shape', async () => {
    const alpha = await project('alpha')
    const beta = await project('beta')
    const foreign = botIn(beta.id)
    const res = await call('POST', '/workspaces/alpha/team', { displayName: 'Ana', slackMemberId: 'U111', botScope: { botIds: [foreign] } })
    expect(res.status).toBe(422)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('unknown_bot')
    expect(listTeamMembers(kit.db, alpha.id)).toEqual([])
    for (const body of [{}, { displayName: 'A', slackMemberId: 'bad' }, { displayName: '', slackMemberId: 'U111' }, { displayName: 'A', slackMemberId: 'U111', email: 'nope' }, { displayName: 'A', slackMemberId: 'U111', botScope: {} }, { displayName: 'A', slackMemberId: 'U111', botScope: { all: false } }]) {
      expect((await call('POST', '/workspaces/alpha/team', body)).status).toBe(400)
    }
    expect((await kit.admin.request('/workspaces/alpha/team', { method: 'POST', body: '{' })).status).toBe(400)
  })

  it('is admin only, 404 across projects and for unknown projects', async () => {
    const alpha = await project('alpha')
    await project('beta')
    const member = addTeamMember(kit.db, alpha.id, input('U111', { all: true }))
    expect((await call('GET', '/workspaces/alpha/team', undefined, viewer())).status).toBe(403)
    expect((await call('POST', '/workspaces/alpha/team', { displayName: 'A', slackMemberId: 'U333' }, viewer())).status).toBe(403)
    expect((await call('GET', `/workspaces/beta/team/${member.id}`)).status).toBe(404)
    expect((await call('GET', '/workspaces/nope/team')).status).toBe(404)
  })
})
