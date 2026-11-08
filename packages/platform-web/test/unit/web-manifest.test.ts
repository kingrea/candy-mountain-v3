import { describe, expect, it } from 'vitest'
import { webManifest } from '../../server/utils/web-manifest'

describe('webManifest', () => {
  it('reproduces the hand-written Candy Mountain manifest from its product', () => {
    expect(webManifest({ name: 'Candy Mountain', description: 'Codebase management platform', theme: { hex: '#ec4899' } })).toEqual({
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
    const manifest = webManifest({ name: 'Acme', description: 'Acme ops', theme: { hex: '#3b82f6' } })
    expect(manifest).toMatchObject({
      name: 'Acme',
      short_name: 'Acme',
      description: 'Acme ops',
      theme_color: '#3b82f6',
    })
  })
})
