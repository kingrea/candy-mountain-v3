import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProductColors } from '@candy-mountain/platform-sdk'
import { loadNuxt } from 'nuxt'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SHELL_STYLESHEET } from '../../modules/platform-web'
import { PLAYGROUND_PRODUCT } from '../../playground/product'
import { SHADES, assertDeclaredColors, readStylesheet } from '../../product-stylesheet.mjs'

const PLAYGROUND = fileURLToPath(new URL('../../playground', import.meta.url))
const BRAND: ProductColors = { primary: 'brand', neutral: 'neutral' }

const scale = (color: string, at = '@theme static') =>
  `${at} {\n${SHADES.map(shade => `  --color-${color}-${shade}: oklch(60% 0.2 ${shade / 4});`).join('\n')}\n}\n`

describe('the product stylesheet in the shell', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cm-product-stylesheet-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  // An undefined override leaves the playground's own theme.css in place, so '' is what hands over no sheet.
  async function load(stylesheet = '', colors: ProductColors = BRAND) {
    const nuxt = await loadNuxt({
      cwd: PLAYGROUND,
      ready: true,
      overrides: { buildDir: join(dir, '.nuxt'), platformWeb: { product: { ...PLAYGROUND_PRODUCT, theme: { ...PLAYGROUND_PRODUCT.theme, colors } }, stylesheet } },
    })
    return nuxt
  }

  it('builds the playground with its own sheet declaring its primary, and fails without it naming that colour', async () => {
    const nuxt = await loadNuxt({ cwd: PLAYGROUND, ready: true, overrides: { buildDir: join(dir, '.nuxt') } })
    try {
      const entry = nuxt.options.build.templates.find(template => template.filename === 'platform-web/styles.css')!
      expect(String(await entry.getContents!({} as never))).toContain(join(PLAYGROUND, 'theme.css'))
    }
    finally {
      await nuxt.close()
    }
    await expect(load('', PLAYGROUND_PRODUCT.theme.colors)).rejects.toThrow('primary is "lagoon", which is not a Tailwind palette, and no product stylesheet declares it')
  }, 60_000)

  it('fails the build naming the alias and the colour no sheet declares', async () => {
    await expect(load()).rejects.toThrow(/primary is "brand", which is not a Tailwind palette, and no product stylesheet declares it/)
    const sheet = join(dir, 'empty.css')
    await writeFile(sheet, ':root { --ui-radius: 0.5rem; }\n')
    await expect(load(sheet)).rejects.toThrow(`primary is "brand", which is not a Tailwind palette, and the product stylesheet ${sheet} does not declare it`)
  }, 60_000)

  it('builds once the sheet declares the scale, compiling it after the shell\'s sheet', async () => {
    const sheet = join(dir, 'theme.css')
    await writeFile(sheet, scale('brand'))
    const nuxt = await load(sheet)
    try {
      expect(nuxt.options.css).not.toContain(SHELL_STYLESHEET)
      const entry = nuxt.options.build.templates.find(template => template.filename === 'platform-web/styles.css')!
      expect(nuxt.options.css).toContain(entry.dst)
      const imports = [...String(await entry.getContents!({} as never)).matchAll(/@import "([^"]+)";/g)].map(match => match[1])
      expect(imports).toEqual([SHELL_STYLESHEET, sheet])
    }
    finally {
      await nuxt.close()
    }
  }, 60_000)

  it('leaves the shell\'s sheet alone when the distribution hands over none', async () => {
    const nuxt = await load('', { primary: 'sky', neutral: 'neutral' })
    try {
      expect(nuxt.options.css).toContain(SHELL_STYLESHEET)
      expect(nuxt.options.build.templates.some(template => template.filename === 'platform-web/styles.css')).toBe(false)
    }
    finally {
      await nuxt.close()
    }
  }, 60_000)
})

describe('assertDeclaredColors', () => {
  const sheet = (css: string) => ({ path: '/product/theme.css', css })

  it('accepts Tailwind palettes without a sheet', () => {
    expect(() => assertDeclaredColors({ primary: 'pink', neutral: 'neutral', error: 'rose', info: undefined })).not.toThrow()
  })

  it('accepts a scale in @theme static or a plain rule', () => {
    expect(() => assertDeclaredColors(BRAND, sheet(scale('brand')))).not.toThrow()
    expect(() => assertDeclaredColors(BRAND, sheet(scale('brand', ':root')))).not.toThrow()
  })

  it('names the shades a partial scale lacks', () => {
    const partial = scale('brand').replace(/\s*--color-brand-(?:900|950):[^;]*;/g, '')
    expect(() => assertDeclaredColors(BRAND, sheet(partial))).toThrow('lacks --color-brand-900, --color-brand-950')
  })

  it('refuses a scale in a @theme block Tailwind drops when no utility uses it', () => {
    expect(() => assertDeclaredColors(BRAND, sheet(scale('brand', '@theme')))).toThrow('declare --color-brand-50 to --color-brand-950 in @theme static instead')
    expect(() => assertDeclaredColors(BRAND, sheet(scale('brand', '@theme inline')))).toThrow('primary is "brand"')
  })

  it('names every undeclared alias, not only the first', () => {
    expect(() => assertDeclaredColors({ ...BRAND, secondary: 'accent' }, sheet(''))).toThrow(/primary is "brand".*\n.*secondary is "accent"/)
  })
})

describe('readStylesheet', () => {
  it('counts a scale declared in a file the sheet imports', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cm-product-stylesheet-import-'))
    try {
      await writeFile(join(dir, 'colors.css'), scale('brand'))
      await writeFile(join(dir, 'theme.css'), '@import "tailwindcss/theme";\n@import "./colors.css";\n/* --color-other-50: red; */\n')
      const css = readStylesheet(join(dir, 'theme.css'))
      expect(() => assertDeclaredColors(BRAND, { path: join(dir, 'theme.css'), css })).not.toThrow()
      expect(css).not.toContain('--color-other-50')
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
