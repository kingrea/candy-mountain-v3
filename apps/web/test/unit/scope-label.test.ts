import type { ScopeLabel } from '@candy-mountain/shared'
import { describe, expect, it, vi } from 'vitest'
import { pluginHealth } from '../../app/utils/modules-setup'
import { registryNavGroups } from '../../app/utils/navigation'
import { PLUGIN_SCOPE_LABELS } from '../../app/utils/plugins'
import { SCOPE, scopeWords } from '../../app/utils/scope-label'

const APP: ScopeLabel = vi.hoisted(() => ({ singular: 'app', plural: 'apps', singularTitle: 'App', pluralTitle: 'Apps' }))

vi.mock('../../shared/utils/product', async (importOriginal) => {
  const { PRODUCT } = await importOriginal<typeof import('../../shared/utils/product')>()
  return { PRODUCT: { ...PRODUCT, scope: { ...PRODUCT.scope, label: APP } } }
})

describe('scope label', () => {
  it('flows from the product configuration into platform copy', () => {
    expect(registryNavGroups(null, null, false).systemGroup.entries.map(entry => entry.label)).toEqual(['Apps', 'Activity', 'Settings'])
    expect(pluginHealth('repository', [], []).detail).toBe('Not configured for this app or the platform.')
    expect(PLUGIN_SCOPE_LABELS.project).toBe('This app')
    expect(SCOPE.aSingular).toBe('an app')
  })

  it('counts and articles every form', () => {
    const words = scopeWords({ singular: 'project', plural: 'projects', singularTitle: 'Project', pluralTitle: 'Projects' })
    expect(words.aSingular).toBe('a project')
    expect([0, 1, 2].map(words.count)).toEqual(['0 projects', '1 project', '2 projects'])
    expect(words.pluralTitle).toBe('Projects')
  })
})
