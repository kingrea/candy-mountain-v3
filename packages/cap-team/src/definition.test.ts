import { WORKSPACES_PATH } from '@crab-shack/platform-sdk'
import type { ModuleDefinition } from '@crab-shack/platform-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureDefinition, testKit, type TestKit } from '@crab-shack/platform-daemon/testing'
import { teamDefinition } from './definition'
import type { TeamMemberListResponse } from './wire'

const TEAM_MODULE: ModuleDefinition = {
  id: 'agent-hub',
  label: 'Agent Hub',
  description: 'Hosts the team capability in tests.',
  icon: 'i-lucide-bot',
  capabilities: [{ capabilityId: 'team', defaultRung: 'manage' }],
}

// Stands in for the bots capability, which declares the fact the team manifest requires.
const botFacts = fixtureDefinition('bots', { manifest: null, workspaceFacts: [{ id: 'hasBots', compute: () => true, message: () => 'No bots yet.' }] })

describe('the team definition', () => {
  let kit: TestKit | undefined

  afterEach(async () => {
    await kit?.close()
    kit = undefined
  })

  function start(withTeam: boolean) {
    kit = testKit(withTeam ? { capabilities: [botFacts, teamDefinition()], modules: [TEAM_MODULE] } : {})
    kit.workspace({ name: 'Alpha', slug: 'alpha' })
    return { platform: kit.platform, app: kit.admin }
  }

  it('serves the team routes', async () => {
    const { platform, app } = start(true)

    expect(platform.runtime.started.map(s => s.definition.id)).toContain('team')
    const res = await app.request(`${WORKSPACES_PATH}/alpha/team`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual<TeamMemberListResponse>({ members: [] })
  })

  it('boots without team, with no team_members table, and its routes answer plain not found', async () => {
    const { platform, app } = start(false)

    expect(platform.runtime.started.map(s => s.definition.id)).not.toContain('team')
    expect(platform.migrationSets.map(set => set.id)).not.toContain('team')
    const res = await app.request(`${WORKSPACES_PATH}/alpha/team`)
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('404 Not Found')
    expect((await app.request(`${WORKSPACES_PATH}/alpha`)).status).toBe(200)
  })
})
