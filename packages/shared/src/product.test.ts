import { describe, expect, it } from 'vitest'
import { MANIFEST_ID_PATTERN } from './capabilities'
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

  it('prefixes workspaces with a single lowercase path segment', () => {
    expect(product.scope.urlPrefix).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
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
