import type { ProductConfig } from '@candy-mountain/shared'

export const WEB_MANIFEST_CONTENT_TYPE = 'application/manifest+json'

// The dark slate neutral from app.config belongs to the shell, not the product.
const BACKGROUND_COLOR = '#0f172a'

export function webManifest(product: Pick<ProductConfig, 'name' | 'description' | 'theme'>) {
  return {
    name: product.name,
    short_name: product.name,
    description: product.description,
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: BACKGROUND_COLOR,
    theme_color: product.theme.hex,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
