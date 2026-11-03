import { describe, expect, it } from 'vitest'
import { isValidSlug, slugify } from './slug'

describe('slugify', () => {
  it('lowercases, strips accents and collapses separators', () => {
    expect(slugify('  Crème Brûlée -- API v2! ')).toBe('creme-brulee-api-v2')
  })

  it('returns an empty string when nothing URL-safe remains', () => {
    expect(slugify('!!!')).toBe('')
  })

  it('never ends in a hyphen after truncation', () => {
    const slug = slugify(`${'a'.repeat(63)} b`)
    expect(slug).toBe('a'.repeat(63))
    expect(isValidSlug(slug)).toBe(true)
  })
})

describe('isValidSlug', () => {
  it('accepts lowercase words joined by single hyphens', () => {
    expect(isValidSlug('candy-mountain-3')).toBe(true)
  })

  it('rejects anything that is not URL-safe', () => {
    for (const bad of ['', 'Upper', 'two--hyphens', '-lead', 'trail-', 'sp ace', 'a/b', 'x'.repeat(65)]) {
      expect(isValidSlug(bad), bad).toBe(false)
    }
  })
})
