import { describe, expect, it } from 'vitest'
import { projectFaviconColor, tintFaviconPixels } from '../../app/utils/favicon'

describe('project favicon', () => {
  const projects = [{ slug: 'alpha', color: '#2563eb' }, { slug: 'beta', color: '#16a34a' }]

  it('follows the route project and uses the default outside a known project', () => {
    expect(projectFaviconColor('alpha', projects)).toBe('#2563eb')
    expect(projectFaviconColor('beta', projects)).toBe('#16a34a')
    expect(projectFaviconColor(undefined, projects)).toBeNull()
    expect(projectFaviconColor('missing', projects)).toBeNull()
    expect(projectFaviconColor('bad', [{ slug: 'bad', color: 'invalid' }])).toBeNull()
  })

  it('recolours red, preserves white and alpha, and keeps the source unchanged', () => {
    const pixels = new Uint8ClampedArray([230, 0, 34, 255, 255, 255, 255, 255, 230, 0, 34, 96])
    expect(Array.from(tintFaviconPixels(pixels, '#2563eb'))).toEqual([37, 99, 235, 255, 255, 255, 255, 255, 37, 99, 235, 96])
    expect(Array.from(pixels.slice(0, 4))).toEqual([230, 0, 34, 255])
  })
})
