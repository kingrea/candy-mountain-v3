import { randomUUID } from 'node:crypto'
import type { CreateTeamMemberRequest, TeamBotScope, TeamMember, UpdateTeamMemberRequest } from '@candy-mountain/shared'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { bots, teamMembers } from '../db/schema'
import { TeamError } from './errors'

type Row = typeof teamMembers.$inferSelect

const toMember = (row: Row): TeamMember => ({ ...row })

function assertBotsInProject(db: Db, projectId: string, scope: TeamBotScope): void {
  if ('all' in scope) return
  const known = new Set(db.select({ id: bots.id }).from(bots).where(eq(bots.projectId, projectId)).all().map(row => row.id))
  const unknown = scope.botIds.filter(id => !known.has(id))
  if (unknown.length > 0) throw new TeamError('unknown_bot', `Not bots of this project: ${unknown.join(', ')}`)
}

function assertSlackIdFree(db: Db, projectId: string, slackMemberId: string, exceptId?: string): void {
  const taken = db.select({ id: teamMembers.id }).from(teamMembers)
    .where(and(eq(teamMembers.projectId, projectId), eq(teamMembers.slackMemberId, slackMemberId)))
    .get()
  if (taken && taken.id !== exceptId) throw new TeamError('slack_member_taken', `Slack member ${slackMemberId} is already on this project's team`)
}

export function listTeamMembers(db: Db, projectId: string): TeamMember[] {
  return db.select().from(teamMembers).where(eq(teamMembers.projectId, projectId))
    .orderBy(asc(sql`lower(${teamMembers.displayName})`), asc(teamMembers.createdAt)).all().map(toMember)
}

export function findTeamMember(db: Db, projectId: string, id: string): TeamMember | null {
  const row = db.select().from(teamMembers).where(and(eq(teamMembers.projectId, projectId), eq(teamMembers.id, id))).get()
  return row ? toMember(row) : null
}

export function findTeamMemberBySlackId(db: Db, projectId: string, slackMemberId: string): TeamMember | null {
  const row = db.select().from(teamMembers).where(and(eq(teamMembers.projectId, projectId), eq(teamMembers.slackMemberId, slackMemberId))).get()
  return row ? toMember(row) : null
}

export function getTeamMember(db: Db, projectId: string, id: string): TeamMember {
  const member = findTeamMember(db, projectId, id)
  if (!member) throw new TeamError('not_found', `No team member with id "${id}" in this project`)
  return member
}

export function addTeamMember(db: Db, projectId: string, input: Required<CreateTeamMemberRequest>): TeamMember {
  return db.transaction((tx) => {
    assertSlackIdFree(tx, projectId, input.slackMemberId)
    assertBotsInProject(tx, projectId, input.botScope)
    const now = new Date().toISOString()
    const row: Row = { id: randomUUID(), projectId, ...input, lastActiveAt: null, createdAt: now, updatedAt: now }
    tx.insert(teamMembers).values(row).run()
    return toMember(row)
  })
}

export function updateTeamMember(db: Db, projectId: string, id: string, input: UpdateTeamMemberRequest): TeamMember {
  return db.transaction((tx) => {
    const current = getTeamMember(tx, projectId, id)
    if (input.slackMemberId !== undefined) assertSlackIdFree(tx, projectId, input.slackMemberId, id)
    if (input.botScope !== undefined) assertBotsInProject(tx, projectId, input.botScope)
    const next = { ...current, ...input, updatedAt: new Date().toISOString() }
    tx.update(teamMembers).set({
      displayName: next.displayName,
      email: next.email,
      slackMemberId: next.slackMemberId,
      botScope: next.botScope,
      updatedAt: next.updatedAt,
    }).where(eq(teamMembers.id, id)).run()
    return next
  })
}

export function removeTeamMember(db: Db, projectId: string, id: string): void {
  getTeamMember(db, projectId, id)
  db.delete(teamMembers).where(eq(teamMembers.id, id)).run()
}

/** Returns false when the Slack member is not on the project's team. */
export function touchMemberActivity(db: Db, projectId: string, slackMemberId: string, at = new Date()): boolean {
  const result = db.update(teamMembers).set({ lastActiveAt: at.toISOString() })
    .where(and(eq(teamMembers.projectId, projectId), eq(teamMembers.slackMemberId, slackMemberId))).run()
  return result.changes > 0
}

/** Fails closed: an unlisted member, or a bot outside the project or the member's scope, is false. */
export function mayMemberTalkToBot(db: Db, projectId: string, slackMemberId: string, botId: string): boolean {
  const member = db.select({ botScope: teamMembers.botScope }).from(teamMembers)
    .where(and(eq(teamMembers.projectId, projectId), eq(teamMembers.slackMemberId, slackMemberId))).get()
  if (!member) return false
  if ('all' in member.botScope) return true
  return member.botScope.botIds.includes(botId)
}
