import type { CapabilityId, ProjectFactId, ReadinessReason, RegistryCapability, RegistryResponse, RegistryView } from '@candy-mountain/shared'
import { projectPluginsPagePath } from './navigation'
import { PROJECTS_PAGE_PATH, projectPath } from './project-scope'
import { SCOPE } from './scope-label'

export const PROJECT_REGISTRY_KEY_PREFIX = 'project-registry:'

export const projectRegistryKey = (slug: string | null) => `${PROJECT_REGISTRY_KEY_PREFIX}${slug ?? ''}`

export type ViewAccess =
  | { state: 'ready', capability: RegistryCapability, view: RegistryView }
  | { state: 'not-ready', capability: RegistryCapability, view: RegistryView }
  | { state: 'not-enabled' }
  | { state: 'not-granted' }

export function resolveViewAccess(registry: RegistryResponse, capabilityId: CapabilityId, viewId: string): ViewAccess {
  const capability = registry.capabilities.find(candidate => candidate.id === capabilityId)
  // The admin holds every capability at its top rung, so an absent one can only mean no enabled module carries it.
  if (!capability) return { state: registry.admin ? 'not-enabled' : 'not-granted' }

  const view = registry.views.find(candidate => candidate.capabilityId === capabilityId && candidate.id === viewId)
  if (!view) return { state: 'not-granted' }
  return { state: view.ready ? 'ready' : 'not-ready', capability, view }
}

export interface LockoutAction {
  label: string
  icon: string
  to: string
}

// A missing project fact is fixed where that fact comes from; anything unlisted is a path fact, re-checked on the Projects page.
const FACT_ACTIONS: Partial<Record<ProjectFactId, { label: string, icon: string, segments: string[] }>> = {
  hasBots: { label: 'Add a bot', icon: 'i-lucide-bot', segments: ['bots'] },
}

export function lockoutActions(reasons: readonly ReadinessReason[], slug: string): LockoutAction[] {
  const actions: LockoutAction[] = []
  const add = (action: LockoutAction) => {
    if (!actions.some(existing => existing.to === action.to)) actions.push(action)
  }
  if (!reasons.length || reasons.some(reason => reason.kind === 'plugin' || reason.kind === 'plugin-any')) {
    add({ label: 'Configure plugins', icon: 'i-lucide-plug', to: projectPluginsPagePath(slug) })
  }
  for (const reason of reasons) {
    if (reason.kind !== 'project-fact') continue
    const fix = FACT_ACTIONS[reason.fact]
    add(fix
      ? { label: fix.label, icon: fix.icon, to: projectPath(slug, ...fix.segments) }
      : { label: `Re-check the ${SCOPE.singular}`, icon: 'i-lucide-folder-git-2', to: PROJECTS_PAGE_PATH })
  }
  return actions
}
