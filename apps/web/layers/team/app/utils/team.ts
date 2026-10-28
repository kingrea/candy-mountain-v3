import type { Bot, TeamBotScope } from '@candy-mountain/shared'

export const TEAM_DATA_KEY_PREFIX = 'team:'
export const TEAM_BOTS_DATA_KEY_PREFIX = 'team-bots:'

export const teamDataKey = (slug: string | null) => `${TEAM_DATA_KEY_PREFIX}${slug ?? ''}`
export const teamBotsDataKey = (slug: string | null) => `${TEAM_BOTS_DATA_KEY_PREFIX}${slug ?? ''}`

export function teamScopeLabels(scope: TeamBotScope, bots: readonly Pick<Bot, 'id' | 'name'>[]): string[] {
  if ('all' in scope) return ['All bots']
  // Deleted bots linger in botIds; they are skipped rather than shown as raw ids.
  const names = new Map(bots.map(bot => [bot.id, bot.name]))
  return scope.botIds.flatMap(id => names.get(id) ?? [])
}

export function teamScopeFromForm(mode: 'all' | 'bots', botIds: readonly string[]): TeamBotScope {
  return mode === 'all' ? { all: true } : { botIds: [...botIds] }
}

export function teamScopeToForm(scope: TeamBotScope | undefined, bots: readonly Pick<Bot, 'id'>[]): { mode: 'all' | 'bots', botIds: string[] } {
  if (!scope) return { mode: 'all', botIds: [] }
  if ('all' in scope) return { mode: 'all', botIds: [] }
  const live = new Set(bots.map(bot => bot.id))
  return { mode: 'bots', botIds: scope.botIds.filter(id => live.has(id)) }
}
