import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Actor, ApiErrorBody, Project, TeamMember } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import type { AuthStrategy } from '../auth'
import { dataPaths } from '../data-dir'
import type { PlatformDatabase } from '../db'
import { bots } from '../db/schema'
import { createProject, deleteProject } from '../projects/projects'
import { openTestDatabase } from '../testing'
import { addTeamMember, listTeamMembers, mayMemberTalkToBot, removeTeamMember, touchMemberActivity } from './service'

let database: PlatformDatabase
let root: string
beforeEach(() => {
  database = openTestDatabase()
  root = mkdtempSync(join(tmpdir(), 'candy-mountain-team-'))
  mkdirSync(join(root, '.beads'))
})
afterEach(() => {
  database.close()
  rmSync(root, { recursive: true, force: true })
})

const project = (name: string): Promise<Project> => createProject(database.db, { name, source: { kind: 'local-path', path: root } })

function botIn(projectId: string): string {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  database.db.insert(bots).values({ id, projectId, name: id, family: 'claude-code', writeScope: 'read-only', answersIn: { anywhere: true }, createdAt: now, updatedAt: now }).run()
  return id
}

function app(roles = ['admin']) {
  const auth: AuthStrategy = { name: 'development', resolve: (): Actor => ({ id: 'u1', username: 'jack', displayName: 'Jack', roles }) }
  return createApp({ db: database.db, paths: dataPaths('/unused'), auth })
}
const call = (method: string, path: string, body?: unknown, roles?: string[]) =>
  app(roles).request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

const input = (slackMemberId: string, botScope: TeamMember['botScope']) => ({ displayName: 'Ana', slackMemberId, email: null, botScope })

describe('team service', () => {
  it('answers the lookup per bot and after removal', async () => {
    const alpha = await project('alpha')
    const [one, two] = [botIn(alpha.id), botIn(alpha.id)]
    const member = addTeamMember(database.db, alpha.id, input('U111', { botIds: [one] }))
    expect(mayMemberTalkToBot(database.db, alpha.id, 'U111', one)).toBe(true)
    expect(mayMemberTalkToBot(database.db, alpha.id, 'U111', two)).toBe(false)
    expect(mayMemberTalkToBot(database.db, alpha.id, 'U999', one)).toBe(false)
    addTeamMember(database.db, alpha.id, input('U222', { all: true }))
    expect(mayMemberTalkToBot(database.db, alpha.id, 'U222', two)).toBe(true)
    removeTeamMember(database.db, alpha.id, member.id)
    expect(mayMemberTalkToBot(database.db, alpha.id, 'U111', one)).toBe(false)
  })

  it('isolates projects, allows the same Slack id in two, and cascades', async () => {
    const [alpha, beta] = [await project('alpha'), await project('beta')]
    addTeamMember(database.db, alpha.id, input('U111', { all: true }))
    addTeamMember(database.db, beta.id, input('U111', { botIds: [] }))
    const betaBot = botIn(beta.id)
    expect(mayMemberTalkToBot(database.db, alpha.id, 'U111', betaBot)).toBe(true)
    expect(mayMemberTalkToBot(database.db, beta.id, 'U111', betaBot)).toBe(false)
    expect(listTeamMembers(database.db, beta.id)).toHaveLength(1)
    deleteProject(database.db, 'alpha')
    expect(listTeamMembers(database.db, alpha.id)).toEqual([])
    expect(listTeamMembers(database.db, beta.id)).toHaveLength(1)
  })

  it('records last activity only for listed members', async () => {
    const alpha = await project('alpha')
    const member = addTeamMember(database.db, alpha.id, input('U111', { all: true }))
    expect(member.lastActiveAt).toBeNull()
    expect(touchMemberActivity(database.db, alpha.id, 'U111', new Date('2026-01-02T00:00:00Z'))).toBe(true)
    expect(touchMemberActivity(database.db, alpha.id, 'U404')).toBe(false)
    expect(listTeamMembers(database.db, alpha.id)[0]!.lastActiveAt).toBe('2026-01-02T00:00:00.000Z')
  })
})

describe('team routes', () => {
  it('adds, lists, updates and removes a member', async () => {
    const alpha = await project('alpha')
    const bot = botIn(alpha.id)
    const created = await call('POST', '/projects/alpha/team', { displayName: ' Ana ', slackMemberId: 'U111', email: 'ana@example.com', botScope: { botIds: [bot] } })
    expect(created.status).toBe(201)
    const { member } = await created.json() as { member: TeamMember }
    expect(member).toMatchObject({ displayName: 'Ana', email: 'ana@example.com', botScope: { botIds: [bot] }, lastActiveAt: null })
    expect(((await (await call('GET', '/projects/alpha/team')).json()) as { members: TeamMember[] }).members).toHaveLength(1)
    const patched = await call('PATCH', `/projects/alpha/team/${member.id}`, { botScope: { all: true }, email: null })
    expect(((await patched.json()) as { member: TeamMember }).member).toMatchObject({ botScope: { all: true }, email: null, displayName: 'Ana' })
    expect((await call('GET', `/projects/alpha/team/${member.id}`)).status).toBe(200)
    expect((await call('DELETE', `/projects/alpha/team/${member.id}`)).status).toBe(204)
    expect((await call('GET', `/projects/alpha/team/${member.id}`)).status).toBe(404)
    expect(mayMemberTalkToBot(database.db, alpha.id, 'U111', bot)).toBe(false)
  })

  it('rejects a duplicate Slack id with 409, on create and on update', async () => {
    await project('alpha')
    await call('POST', '/projects/alpha/team', { displayName: 'Ana', slackMemberId: 'U111' })
    const dup = await call('POST', '/projects/alpha/team', { displayName: 'Ben', slackMemberId: 'U111' })
    expect(dup.status).toBe(409)
    expect(((await dup.json()) as ApiErrorBody).error.code).toBe('slack_member_taken')
    const ben = await (await call('POST', '/projects/alpha/team', { displayName: 'Ben', slackMemberId: 'U222' })).json() as { member: TeamMember }
    expect((await call('PATCH', `/projects/alpha/team/${ben.member.id}`, { slackMemberId: 'U111' })).status).toBe(409)
    expect((await call('PATCH', `/projects/alpha/team/${ben.member.id}`, { slackMemberId: 'U222' })).status).toBe(200)
  })

  it('validates bot ids against the project and the body shape', async () => {
    const alpha = await project('alpha')
    const beta = await project('beta')
    const foreign = botIn(beta.id)
    const res = await call('POST', '/projects/alpha/team', { displayName: 'Ana', slackMemberId: 'U111', botScope: { botIds: [foreign] } })
    expect(res.status).toBe(422)
    expect(((await res.json()) as ApiErrorBody).error.code).toBe('unknown_bot')
    expect(listTeamMembers(database.db, alpha.id)).toEqual([])
    for (const body of [{}, { displayName: 'A', slackMemberId: 'bad' }, { displayName: '', slackMemberId: 'U111' }, { displayName: 'A', slackMemberId: 'U111', email: 'nope' }, { displayName: 'A', slackMemberId: 'U111', botScope: {} }, { displayName: 'A', slackMemberId: 'U111', botScope: { all: false } }]) {
      expect((await call('POST', '/projects/alpha/team', body)).status).toBe(400)
    }
    expect((await app().request('/projects/alpha/team', { method: 'POST', body: '{' })).status).toBe(400)
  })

  it('is admin only, 404 across projects and for unknown projects', async () => {
    const alpha = await project('alpha')
    await project('beta')
    const member = addTeamMember(database.db, alpha.id, input('U111', { all: true }))
    expect((await call('GET', '/projects/alpha/team', undefined, ['viewer'])).status).toBe(403)
    expect((await call('POST', '/projects/alpha/team', { displayName: 'A', slackMemberId: 'U333' }, ['viewer'])).status).toBe(403)
    expect((await call('GET', `/projects/beta/team/${member.id}`)).status).toBe(404)
    expect((await call('GET', '/projects/nope/team')).status).toBe(404)
  })
})
