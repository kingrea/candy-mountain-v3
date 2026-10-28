import { describe, expect, it } from 'vitest'
import type { AnyCapabilityManifest } from '@candy-mountain/shared'
import { cloneManifest, fixtureCapability } from './fixtures'
import { assertCapability, CapabilityManifestError, defineCapability, getRung, rungIndex, topRung } from './manifest'

const valid = () => cloneManifest(fixtureCapability('uptime'))
const rejects = (cap: unknown, message: string | RegExp) => {
  expect(() => assertCapability(cap as AnyCapabilityManifest)).toThrow(CapabilityManifestError)
  expect(() => assertCapability(cap as AnyCapabilityManifest)).toThrow(message)
}

describe('defineCapability', () => {
  it('loads a valid manifest unchanged', () => {
    const cap = defineCapability({
      id: 'uptime',
      label: 'Uptime',
      description: 'Monitors.',
      views: [{ id: 'uptime-board', label: 'Uptime', icon: 'i-lucide-activity', path: 'uptime' }],
      agents: [],
      jobs: [],
      requiresPlugins: [],
      tools: [{ id: 'uptime.list', kind: 'tool' }],
      ladder: [
        { name: 'none', label: 'None', description: 'Nothing.', views: [], chat: false, tools: {} },
        { name: 'read', label: 'Read', description: 'See monitors.', views: ['uptime-board'], chat: false, tools: { 'uptime.list': {} } },
      ],
    })
    expect(cap.id).toBe('uptime')
    expect(cap.ladder.map(r => r.name)).toEqual(['none', 'read'])
    expect(rungIndex(cap, 'read')).toBe(1)
    expect(getRung(cap, 'missing')).toBeUndefined()
    expect(topRung(cap).name).toBe('read')
  })

  it('accepts the project home as an empty view path', () => {
    const cap = valid()
    cap.views[0]!.path = ''
    expect(() => assertCapability(cap)).not.toThrow()
  })

  it('throws from defineCapability itself so a bad manifest file fails on import', () => {
    const cap = valid()
    cap.ladder.reverse()
    expect(() => defineCapability(cap as never)).toThrow(CapabilityManifestError)
  })

  it('rejects mistakes at compile time too', () => {
    const base = { id: 'uptime', label: 'U', description: 'U.', agents: [], jobs: [], requiresPlugins: [] } as const
    expect(() =>
      defineCapability({
        ...base,
        views: [{ id: 'board', label: 'B', icon: 'i', path: 'uptime' }],
        tools: [],
        // @ts-expect-error the first rung must be named none
        ladder: [{ name: 'read', label: 'R', description: 'R.', views: ['board'], chat: false, tools: {} }],
      }),
    ).toThrow()
    expect(() =>
      defineCapability({
        ...base,
        views: [{ id: 'board', label: 'B', icon: 'i', path: 'uptime' }],
        tools: [],
        // @ts-expect-error unknown view id
        ladder: [
          { name: 'none', label: 'N', description: 'N.', views: [], chat: false, tools: {} },
          { name: 'read', label: 'R', description: 'R.', views: ['nope'], chat: false, tools: {} },
        ],
      }),
    ).toThrow()
  })
})

describe('assertCapability', () => {
  it('rejects a ladder that does not start at none', () => {
    const cap = valid()
    cap.ladder.shift()
    rejects(cap, "Capability 'uptime': the ladder must start with a rung named 'none'.")
  })

  it('rejects an empty ladder', () => {
    const cap = valid()
    cap.ladder = []
    rejects(cap, /must start with a rung named 'none'/)
  })

  it('rejects a none rung that grants something', () => {
    const cap = valid()
    cap.ladder[0]!.views = ['uptime-home']
    rejects(cap, "rung 'none' must grant nothing.")
  })

  describe('monotonic ladders', () => {
    it('rejects a rung that hides a view the rung below shows', () => {
      const cap = valid()
      cap.ladder[2]!.views = ['uptime-admin']
      rejects(cap, "Capability 'uptime': rung 'full' hides view(s) 'uptime-home' that 'read' shows; rungs must be monotonic.")
    })

    it('rejects a rung that drops chat', () => {
      const cap = valid()
      cap.ladder[1]!.chat = true
      cap.ladder[2]!.chat = false
      rejects(cap, "rung 'full' drops chat that 'read' allows")
    })

    it('rejects a rung that drops a tool', () => {
      const cap = valid()
      delete cap.ladder[2]!.tools['uptime.read']
      rejects(cap, "rung 'full' grants less on tool 'uptime.read' than 'read'")
    })

    it('rejects a rung that narrows a tool scope', () => {
      const cap = valid()
      cap.ladder[1]!.tools['uptime.search'] = { scope: 'all' }
      cap.ladder[2]!.tools['uptime.search'] = { scope: 'own' }
      rejects(cap, "rung 'full' grants less on tool 'uptime.search' than 'read'")
    })
  })

  it('rejects a rung referencing an unknown view', () => {
    const cap = valid()
    cap.ladder[2]!.views.push('ghost')
    rejects(cap, "Capability 'uptime': rung 'full' shows unknown view 'ghost'.")
  })

  it('rejects a rung referencing an unknown tool', () => {
    const cap = valid()
    cap.ladder[2]!.tools['ghost.tool'] = {}
    rejects(cap, "Capability 'uptime': rung 'full' grants unknown tool 'ghost.tool'.")
  })

  it('rejects scope grants that do not match the tool', () => {
    const scoped = valid()
    scoped.ladder[2]!.tools['uptime.search'] = { scope: 'everything' }
    rejects(scoped, "rung 'full' must grant 'uptime.search' one of the scope levels 'own', 'all'.")

    const unscoped = valid()
    unscoped.ladder[2]!.tools['uptime.read'] = { scope: 'all' }
    rejects(unscoped, "rung 'full' grants a scope on unscoped tool 'uptime.read'.")
  })

  it('rejects chat on a capability with no agents', () => {
    const cap = valid()
    cap.agents = []
    rejects(cap, "rung 'full' allows chat but the capability has no agents.")
  })

  it('rejects ids outside the fixed capability list', () => {
    rejects({ ...valid(), id: 'billing' }, "Unknown capability id 'billing'")
  })

  it('rejects duplicate and malformed ids within a manifest', () => {
    const dup = valid()
    dup.views.push({ ...dup.views[0]!, path: 'other' })
    rejects(dup, "duplicate view id(s) 'uptime-home'.")

    const malformed = valid()
    malformed.tools[0]!.id = 'Has Spaces'
    rejects(malformed, "invalid tool id(s) 'Has Spaces'")
  })

  it('rejects bad view paths', () => {
    for (const path of ['/uptime', 'uptime/', 'Up Time', '../x']) {
      const cap = valid()
      cap.views[0]!.path = path
      rejects(cap, `view 'uptime-home' has invalid path '${path}'`)
    }
    const dup = valid()
    dup.views[1]!.path = dup.views[0]!.path
    rejects(dup, "duplicate view path(s) 'uptime'.")
  })

  it('accepts known project facts and rejects unknown or repeated ones', () => {
    expect(() => assertCapability({ ...valid(), requiresProjectFacts: ['hasBeads', 'isGitRepo'] })).not.toThrow()
    rejects({ ...valid(), requiresProjectFacts: ['hasDocker'] }, "requires unknown project fact(s) 'hasDocker'; facts are 'hasBeads', 'isGitRepo', 'hasRemote', 'hasBots'.")
    rejects({ ...valid(), requiresProjectFacts: ['hasBeads', 'hasBeads'] }, "repeats required project fact(s) 'hasBeads'.")
  })

  it('accepts any-of plugin groups and rejects unknown, repeated, single or already required types', () => {
    expect(() => assertCapability({ ...valid(), requiresPlugins: ['repository'], requiresAnyPlugins: [['claude-code', 'codex']] })).not.toThrow()
    rejects({ ...valid(), requiresAnyPlugins: [['claude-code', 'gitlab']] }, "has unknown plugin type(s) 'gitlab' in an any-of group.")
    rejects({ ...valid(), requiresAnyPlugins: [['codex', 'codex']] }, "repeats plugin type(s) 'codex' in an any-of group.")
    rejects({ ...valid(), requiresAnyPlugins: [['codex']] }, 'an any-of plugin group needs at least two plugin types')
    rejects({ ...valid(), requiresPlugins: ['codex'], requiresAnyPlugins: [['claude-code', 'codex']] }, "plugin type(s) 'codex' are both required and in an any-of group.")
  })
})
