import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { colorModeOptions, LOCKED_STORAGE_KEY } from '../../color-mode.mjs'

describe('colorModeOptions', () => {
  it('uses the product default and the stock storage when the user may switch', () => {
    expect(colorModeOptions({ default: 'system', switchable: true })).toEqual({ preference: 'system' })
  })

  it('forces the default through a storage key no toggle writes when the user may not switch', () => {
    expect(colorModeOptions({ default: 'dark', switchable: false })).toEqual({ preference: 'dark', storageKey: LOCKED_STORAGE_KEY })
    expect(LOCKED_STORAGE_KEY).not.toBe('nuxt-color-mode')
  })
})

describe('dashboard layout', () => {
  it('renders the toggle only when the product lets the user switch', () => {
    const layout = readFileSync(new URL('../../app/layouts/dashboard.vue', import.meta.url), 'utf8')
    expect(layout).toMatch(/<UColorModeButton v-if="PRODUCT\.theme\.colorMode\.switchable"/)
  })
})
