// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import AppHeader from '../../app/components/AppHeader.vue'
import { renderLayerPage } from '../kit'

const logo = vi.hoisted(() => ({ current: { name: 'i-lucide-box' } as { name: string } | { src: string, class?: string } }))

vi.mock('#platform-web/product', async (importOriginal) => {
  const { product } = await importOriginal<typeof import('#platform-web/product')>()
  return { product: { ...product, theme: { ...product.theme, get logo() { return logo.current } } } }
})

describe('AppHeader logo', () => {
  it('renders an icon-name logo as an icon', async () => {
    logo.current = { name: 'i-lucide-mountain' }
    const page = await renderLayerPage(AppHeader)
    expect(page.find('[data-ui="UIcon"]').attributes('name')).toBe('i-lucide-mountain')
    expect(page.find('img').exists()).toBe(false)
    page.unmount()
  })

  it('renders an image logo as an img with its classes', async () => {
    logo.current = { src: '/logo.svg', class: 'rounded-sm' }
    const page = await renderLayerPage(AppHeader)
    const img = page.find('img')
    expect(img.attributes('src')).toBe('/logo.svg')
    expect(img.classes()).toContain('rounded-sm')
    page.unmount()
  })
})
