import type { Workspace } from '@candy-mountain/shared'
import { markRaw, type Component } from 'vue'

/**
 * Named places on a row of the projects list where layers add detail: `detail` sits under the name and slug,
 * `badges` beside the row's actions menu.
 */
export const PROJECT_ROW_SLOTS = ['detail', 'badges'] as const

export type ProjectRowSlot = (typeof PROJECT_ROW_SLOTS)[number]

/** Props every row item receives. */
export interface ProjectRowItemProps {
  project: Workspace
}

export interface ProjectRowItem {
  /** Unique within the slot, usually the contributing layer's id; registering it again replaces the earlier item. */
  id: string
  component: Component
}

/** A toast the page shows after an action succeeds. */
export interface ProjectRowActionNote {
  title: string
  description?: string
}

/** An entry a layer adds to every row's actions menu, after Edit. */
export interface ProjectRowAction {
  /** Unique, usually the contributing layer's id; registering it again replaces the earlier action. */
  id: string
  label: string
  icon: string
  /** A throw is shown above the list; the page refreshes the projects afterwards either way. */
  run: (project: Workspace) => Promise<ProjectRowActionNote | undefined>
}

const projectRowItemsBySlot = new Map<ProjectRowSlot, Map<string, ProjectRowItem>>()
const projectRowActionsById = new Map<string, ProjectRowAction>()

/**
 * Adds an item to a slot of every projects list row. Call it from the Nuxt plugin of the layer that owns the item,
 * with defineAsyncComponent so it loads lazily. Items in one slot render in registration order.
 */
export function registerProjectRowItem(slot: ProjectRowSlot, item: ProjectRowItem): void {
  const items = projectRowItemsBySlot.get(slot) ?? new Map<string, ProjectRowItem>()
  items.set(item.id, { id: item.id, component: markRaw(item.component) })
  projectRowItemsBySlot.set(slot, items)
}

export function projectRowItems(slot: ProjectRowSlot): ProjectRowItem[] {
  return [...(projectRowItemsBySlot.get(slot)?.values() ?? [])]
}

export function registerProjectRowAction(action: ProjectRowAction): void {
  projectRowActionsById.set(action.id, action)
}

export function projectRowActions(): ProjectRowAction[] {
  return [...projectRowActionsById.values()]
}
