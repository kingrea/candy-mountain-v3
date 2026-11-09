// @vitest-environment happy-dom
import { layerRegistry, renderLayerPage } from '@crab-shack/platform-web/test'
import { describe, expect, it } from 'vitest'
import TeamPage from '../../app/pages/p/[project]/team/index.vue'

const member = (id: string, displayName: string) => ({
  id, displayName, email: null, slackMemberId: `U${id}`, botScope: { all: true }, lastActiveAt: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const api = {
  'GET /workspaces/acme/team': { members: [member('1', 'Ana'), member('2', 'Ben')] },
  'GET /workspaces/acme/team/bots': { bots: [] },
}

describe('team page', () => {
  it('lists the roster inside the gate when the view is granted', async () => {
    const page = await renderLayerPage(TeamPage, { api, registry: layerRegistry({ rung: 'manage' }) })
    expect(page.gate()).toBe('ready')
    expect(page.findAll('[data-testid="team-table"] tbody tr')).toHaveLength(2)
    expect(page.text()).toContain('Ana')
    expect(page.findAll('[data-testid="member-bots-cell"]').map(cell => cell.text())).toEqual(['All bots', 'All bots'])
    page.unmount()
  })

  it('locks the page and fetches nothing of the team when the view is denied', async () => {
    const page = await renderLayerPage(TeamPage, { api, registry: layerRegistry({ access: 'denied' }) })
    expect(page.gate()).toBe('not-granted')
    expect(page.byTestId('team-table').exists()).toBe(false)
    expect(page.calls.map(call => call.path)).not.toContain('/workspaces/acme/team')
    page.unmount()
  })
})
