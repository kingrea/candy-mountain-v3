import { describe, expect, it } from 'vitest'
import { workspaceFaviconColor, tintFaviconPixels } from '../../app/utils/favicon'

describe('workspace favicon', () => {
  const workspaces = [{ slug: 'alpha', color: '#2563eb' }, { slug: 'beta', color: '#16a34a' }]

  it('follows the route\'s workspace and uses the default outside a known workspace', () => {
    expect(workspaceFaviconColor('alpha', workspaces)).toBe('#2563eb')
    expect(workspaceFaviconColor('beta', workspaces)).toBe('#16a34a')
    expect(workspaceFaviconColor(undefined, workspaces)).toBeNull()
    expect(workspaceFaviconColor('missing', workspaces)).toBeNull()
    expect(workspaceFaviconColor('bad', [{ slug: 'bad', color: 'invalid' }])).toBeNull()
  })

  it('recolours red, preserves white and alpha, and keeps the source unchanged', () => {
    const pixels = new Uint8ClampedArray([230, 0, 34, 255, 255, 255, 255, 255, 230, 0, 34, 96])
    expect(Array.from(tintFaviconPixels(pixels, '#2563eb'))).toEqual([37, 99, 235, 255, 255, 255, 255, 255, 37, 99, 235, 96])
    expect(Array.from(pixels.slice(0, 4))).toEqual([230, 0, 34, 255])
  })
})
