import { CANDY_MOUNTAIN_PRODUCT } from '@candy-mountain/shared'
import { describe, expect, it } from 'vitest'
import { webManifest } from '../../server/utils/web-manifest'
import { PRODUCT } from '../../shared/utils/product'

describe('webManifest', () => {
  it('serves the shell product', () => {
    expect(PRODUCT).toBe(CANDY_MOUNTAIN_PRODUCT)
  })

  it('reproduces the hand-written Candy Mountain manifest', () => {
    expect(webManifest(CANDY_MOUNTAIN_PRODUCT)).toEqual({
      name: 'Candy Mountain',
      short_name: 'Candy Mountain',
      description: 'Codebase management platform',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#0f172a',
      theme_color: '#ec4899',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    })
  })

  it('follows the product configuration', () => {
    const manifest = webManifest({ name: 'Acme', description: 'Acme ops', theme: { primary: 'blue', hex: '#3b82f6' } })
    expect(manifest).toMatchObject({
      name: 'Acme',
      short_name: 'Acme',
      description: 'Acme ops',
      theme_color: '#3b82f6',
    })
  })
})
