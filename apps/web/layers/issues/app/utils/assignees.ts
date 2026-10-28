export const ISSUES_UNASSIGN_VALUE = '\u0000unassign'

export interface IssuesAssigneeItem {
  label: string
  value: string
  icon?: string
}

/** A name already on the issue but missing from the project list stays selectable so the field never renders blank. */
export function issuesAssigneeItems(names: readonly string[], current: string | null): IssuesAssigneeItem[] {
  const all = current !== null && !names.some(name => name === current) ? [...names, current] : names
  const items: IssuesAssigneeItem[] = all.map(name => ({ label: name, value: name }))
  if (current !== null) items.push({ label: 'Unassign', value: ISSUES_UNASSIGN_VALUE, icon: 'i-lucide-user-x' })
  return items
}

export function issuesAssigneeFromSelection(value: string | null | undefined): string | null {
  return value == null || value === ISSUES_UNASSIGN_VALUE ? null : value
}
