import type { Organisation, Project } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import {
  groupProjectsByOrganisation,
  navigationProjectSlug,
  projectPath,
  projectPickerItems,
  projectSwitchPath,
  UNGROUPED_LABEL,
} from '../../app/utils/project-scope'

const TIMESTAMP = '2026-10-27T00:00:00.000Z'

function organisation(slug: string, name: string): Organisation {
  return { id: `org-${slug}`, slug, name, createdAt: TIMESTAMP, updatedAt: TIMESTAMP }
}

function project(slug: string, name: string, organisationId: string | null, archived = false): Project {
  return {
    id: `project-${slug}`,
    slug,
    name,
    color: '#ec4899',
    organisationId,
    archived,
    archivedAt: archived ? TIMESTAMP : null,
    source: { kind: 'local-path', path: `/code/${slug}` },
    verification: {
      checkedAt: TIMESTAMP,
      pathExists: true,
      hasBeads: true,
      isGitRepo: true,
      hasRemote: false,
      remoteName: null,
      remoteUrl: null,
    },
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  }
}

const acme = organisation('acme', 'Acme')
const zeta = organisation('zeta', 'Zeta')
const empty = organisation('empty', 'Empty')

describe('groupProjectsByOrganisation', () => {
  it('groups by organisation name with ungrouped projects last', () => {
    const groups = groupProjectsByOrganisation(
      [
        project('loose', 'Loose', null),
        project('z-two', 'Two', zeta.id),
        project('a-one', 'One', acme.id),
        project('z-one', 'One', zeta.id),
      ],
      [zeta, acme],
    )

    expect(groups.map(group => group.organisation?.slug ?? null)).toEqual(['acme', 'zeta', null])
    expect(groups.map(group => group.projects.map(item => item.slug))).toEqual([['a-one'], ['z-one', 'z-two'], ['loose']])
  })

  it('omits archived projects and organisations left without projects', () => {
    const groups = groupProjectsByOrganisation(
      [project('old', 'Old', empty.id, true), project('live', 'Live', acme.id)],
      [acme, empty],
    )

    expect(groups).toEqual([{ organisation: acme, projects: [expect.objectContaining({ slug: 'live' })] }])
  })

  it('treats a project whose organisation is unknown as ungrouped', () => {
    const groups = groupProjectsByOrganisation([project('orphan', 'Orphan', 'org-gone')], [acme])

    expect(groups).toEqual([{ organisation: null, projects: [expect.objectContaining({ slug: 'orphan' })] }])
  })

  it('breaks name ties by slug', () => {
    const groups = groupProjectsByOrganisation([project('same-b', 'Same', null), project('same-a', 'Same', null)], [])

    expect(groups[0]?.projects.map(item => item.slug)).toEqual(['same-a', 'same-b'])
  })
})

describe('projectPickerItems', () => {
  it('makes organisations non-selectable headings and keeps ungrouped last', () => {
    const items = projectPickerItems(
      groupProjectsByOrganisation([project('loose', 'Loose', null), project('one', 'One', acme.id)], [acme]),
    )

    expect(items).toEqual([
      [{ type: 'label', label: 'Acme' }, { type: 'item', label: 'One', value: 'one', color: '#ec4899' }],
      [{ type: 'label', label: UNGROUPED_LABEL }, { type: 'item', label: 'Loose', value: 'loose', color: '#ec4899' }],
    ])
  })

  it('leaves out the heading when every project is ungrouped', () => {
    const items = projectPickerItems(groupProjectsByOrganisation([project('loose', 'Loose', null)], [acme]))

    expect(items).toEqual([[{ type: 'item', label: 'Loose', value: 'loose', color: '#ec4899' }]])
  })
})

describe('navigationProjectSlug', () => {
  const projects = [project('alpha', 'Alpha', null), project('old', 'Old', null, true)]

  it('follows the route on project pages', () => {
    expect(navigationProjectSlug('beta', 'alpha', projects)).toBe('beta')
  })

  it('keeps the last opened project on system pages', () => {
    expect(navigationProjectSlug(null, 'alpha', projects)).toBe('alpha')
  })

  it('shows no project when the last one is unknown, archived or never chosen', () => {
    expect(navigationProjectSlug(null, 'gone', projects)).toBeNull()
    expect(navigationProjectSlug(null, 'old', projects)).toBeNull()
    expect(navigationProjectSlug(null, null, projects)).toBeNull()
    expect(navigationProjectSlug(null, 'alpha', [])).toBeNull()
  })
})

describe('projectSwitchPath', () => {
  it('keeps the same page for the other project', () => {
    expect(projectSwitchPath('/p/:project()/issues', 'beta')).toBe('/p/beta/issues')
    expect(projectSwitchPath('/p/:project()/settings/plugins', 'beta')).toBe('/p/beta/settings/plugins')
    expect(projectSwitchPath('/p/:project()', 'beta')).toBe('/p/beta')
  })

  it('drops item segments that belong to the previous project', () => {
    expect(projectSwitchPath('/p/:project()/issues/:id()', 'beta')).toBe('/p/beta/issues')
    expect(projectSwitchPath('/p/:project()/files/:path(.*)*', 'beta')).toBe('/p/beta/files')
  })

  it('opens the project home from pages outside a project', () => {
    expect(projectSwitchPath('/projects', 'beta')).toBe('/p/beta')
    expect(projectSwitchPath('/settings', 'beta')).toBe('/p/beta')
    expect(projectSwitchPath(undefined, 'beta')).toBe('/p/beta')
  })

  it('does not mistake a similarly named param for the project', () => {
    expect(projectSwitchPath('/x/:projectId()/issues', 'beta')).toBe('/p/beta')
  })
})

describe('projectPath', () => {
  it('builds project-scoped paths', () => {
    expect(projectPath('alpha')).toBe('/p/alpha')
    expect(projectPath('alpha', 'issues')).toBe('/p/alpha/issues')
  })
})
