import { chatThreadLink, MANIFEST_ID_PATTERN, registrySystemGroup, workspaceViewRoute } from '@candy-mountain/platform-sdk'
import { describe, expect, it } from 'vitest'
import { MODULES } from './modules'
import { CANDY_MOUNTAIN_PRODUCT as product } from './product'

describe('CANDY_MOUNTAIN_PRODUCT', () => {
  it('has a name and a label in every form', () => {
    expect(product.name.trim()).not.toBe('')
    expect(product.description.trim()).not.toBe('')
    for (const form of Object.values(product.scope.label)) {
      expect(form.trim()).not.toBe('')
    }
  })

  it('has a theme colour as a Nuxt UI name and a hex', () => {
    expect(product.theme.primary).toMatch(/^[a-z]+$/)
    expect(product.theme.hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('prefixes workspaces and names their list page with single lowercase path segments', () => {
    expect(product.scope.urlPrefix).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(product.scope.listPath).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })

  it('keeps project links under /p/ and the project list at /projects', () => {
    expect(workspaceViewRoute(product.scope.urlPrefix, 'acme', '')).toBe('/p/acme')
    expect(chatThreadLink(product.scope.urlPrefix, 'acme', 't1')).toBe('/p/acme?thread=t1')
    expect(registrySystemGroup(product.scope.label, product.scope.listPath).entries[0]).toMatchObject({ id: 'projects', label: 'Projects', to: '/projects' })
  })

  it.each(['capabilities', 'modules', 'pluginTypes', 'layers'] as const)('lists valid, unique %s ids', (key) => {
    const ids = product[key]
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(id, id).toMatch(MANIFEST_ID_PATTERN)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// The daemon would refuse either drift at boot; catching it here names the data to edit.
describe('MODULES', () => {
  it('are the modules the product lists', () => {
    expect(MODULES.map(m => m.id)).toEqual(product.modules)
  })

  it('hold only capabilities the product lists', () => {
    const unlisted = MODULES.flatMap(m => m.capabilities.filter(c => !product.capabilities.includes(c.capabilityId)).map(c => `${m.id}: ${c.capabilityId}`))
    expect(unlisted).toEqual([])
  })
})
