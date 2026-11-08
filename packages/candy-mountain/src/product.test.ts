import { chatThreadLink, MANIFEST_ID_PATTERN, registrySystemGroup, workspaceViewRoute } from '@candy-mountain/platform-sdk'
import { describe, expect, it } from 'vitest'
import { CANDY_MOUNTAIN_DEVELOPMENT as development, CANDY_MOUNTAIN_DEVELOPMENT_PRODUCT, DEVELOPMENT_MODULES } from './development'
import { MODULES } from './modules'
import { CANDY_MOUNTAIN_PRODUCT as product } from './product'

const LISTS = ['capabilities', 'modules', 'pluginTypes', 'layers'] as const

describe('CANDY_MOUNTAIN_PRODUCT', () => {
  it('has a name and a label in every form', () => {
    expect(product.name.trim()).not.toBe('')
    expect(product.description.trim()).not.toBe('')
    for (const form of Object.values(product.scope.label)) {
      expect(form.trim()).not.toBe('')
    }
  })

  it('names a colour scale for every alias it sets, and the primary colour as a hex', () => {
    expect(product.theme.colors).toEqual({ primary: 'pink', neutral: 'neutral' })
    for (const scale of Object.values(product.theme.colors)) {
      expect(scale).toMatch(/^[a-z]+(?:-[a-z]+)*$/)
    }
    expect(product.theme.hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('has the mountain icon as its logo', () => {
    expect(product.theme.logo).toEqual({ name: 'i-lucide-mountain-snow' })
  })

  it('follows the system colour mode and lets the user switch it', () => {
    expect(product.theme.colorMode).toEqual({ default: 'system', switchable: true })
  })

  it('keeps the theme plain JSON data', () => {
    expect(JSON.parse(JSON.stringify(product.theme))).toEqual(product.theme)
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

  it.each(LISTS)('lists valid, unique %s ids', (key) => {
    const ids = product[key]
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(id, id).toMatch(MANIFEST_ID_PATTERN)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// A build must not know the development ids; a development run must know every production id.
describe('CANDY_MOUNTAIN_DEVELOPMENT', () => {
  it.each(LISTS)('adds valid %s ids the build does not list', (key) => {
    for (const id of development[key]) {
      expect(id, id).toMatch(MANIFEST_ID_PATTERN)
    }
    expect(development[key].filter(id => product[key].includes(id))).toEqual([])
    expect(CANDY_MOUNTAIN_DEVELOPMENT_PRODUCT[key]).toEqual([...product[key], ...development[key]])
  })

  it('keeps a development capability out of the build\'s layers and modules', () => {
    const capabilities = new Set(development.capabilities)
    expect(product.layers.filter(id => capabilities.has(id))).toEqual([])
    expect(MODULES.flatMap(m => m.capabilities.filter(c => capabilities.has(c.capabilityId)).map(c => `${m.id}: ${c.capabilityId}`))).toEqual([])
  })

  it('includes the template in both apps', () => {
    expect(development.capabilities).toContain('template')
    expect(development.layers).toContain('template')
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

describe('DEVELOPMENT_MODULES', () => {
  it('are the modules the development declaration lists, each holding a capability a development run has', () => {
    expect(DEVELOPMENT_MODULES.map(m => m.id)).toEqual(development.modules)
    const known = CANDY_MOUNTAIN_DEVELOPMENT_PRODUCT.capabilities
    const unlisted = DEVELOPMENT_MODULES.flatMap(m => m.capabilities.filter(c => !known.includes(c.capabilityId)).map(c => `${m.id}: ${c.capabilityId}`))
    expect(unlisted).toEqual([])
    expect(DEVELOPMENT_MODULES.flatMap(m => m.capabilities.map(c => c.capabilityId))).toContain('template')
  })
})
