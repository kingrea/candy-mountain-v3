import { REGISTRY_SYSTEM_GROUP, type RegistryResponse } from '@candy-mountain/shared'
import { projectPath } from './project-scope'

export interface NavEntry {
  id: string
  label: string
  icon: string
  to: string
  /** The view's capability is not ready for the project; only the admin sees such entries. */
  locked?: boolean
  /** Active only on its own route; the project home's route prefixes every other project route. */
  exact?: boolean
}

export interface NavGroup {
  id: string
  label: string
  entries: NavEntry[]
  warning?: string
}

export const PROJECT_SETUP_SEGMENT = 'setup'
export const GRANTS_PAGE_PATH = '/grants'

export const projectModulesPagePath = (slug: string) => projectPath(slug, PROJECT_SETUP_SEGMENT, 'modules')
export const projectPluginsPagePath = (slug: string) => projectPath(slug, PROJECT_SETUP_SEGMENT, 'plugins')
export const projectNotificationsPagePath = (slug: string) => projectPath(slug, PROJECT_SETUP_SEGMENT, 'notifications')

const DEGRADED_FALLBACK = 'Some capabilities in this module need setup.'

// Admin-only: the daemon refuses setup changes from other roles, so linking them would only lead to errors.
export function setupNavEntries(slug: string | null, admin: boolean): NavEntry[] {
  if (!admin) return []
  const entries: NavEntry[] = []
  if (slug) {
    entries.push(
      { id: 'modules', label: 'Modules', icon: 'i-lucide-blocks', to: projectModulesPagePath(slug) },
      { id: 'plugins', label: 'Plugins', icon: 'i-lucide-plug', to: projectPluginsPagePath(slug) },
      { id: 'notifications', label: 'Notifications', icon: 'i-lucide-bell', to: projectNotificationsPagePath(slug) },
    )
  }
  entries.push({ id: 'grants', label: 'Grants', icon: 'i-lucide-key-round', to: GRANTS_PAGE_PATH })
  return entries
}

function degradedWarning(registry: RegistryResponse, groupId: string): string {
  const reasons = registry.degraded.find(module => module.id === groupId)?.reasons ?? []
  const messages = [...new Set(reasons.map(reason => reason.message))]
  return messages.length ? messages.join(' ') : DEGRADED_FALLBACK
}

export function registryNavGroups(
  registry: RegistryResponse | null,
  slug: string | null,
  admin: boolean,
): { capabilityGroups: NavGroup[], systemGroup: NavGroup } {
  const lockedRoutes = new Set(registry?.views.filter(view => !view.ready).map(view => view.to))
  const homeRoutes = new Set(registry?.views.filter(view => view.path === '').map(view => view.to))
  const capabilityGroups = (registry?.groups ?? [])
    .filter(group => group.kind !== 'system')
    .map(group => ({
      id: group.id,
      label: group.label,
      entries: group.entries.map(entry => ({ ...entry, locked: lockedRoutes.has(entry.to), exact: homeRoutes.has(entry.to) })),
      warning: group.degraded ? degradedWarning(registry!, group.id) : undefined,
    }))

  const system = registry?.groups.find(group => group.kind === 'system') ?? REGISTRY_SYSTEM_GROUP
  return {
    capabilityGroups,
    systemGroup: {
      id: system.id,
      label: system.label,
      entries: [...setupNavEntries(slug, admin), ...system.entries],
    },
  }
}
