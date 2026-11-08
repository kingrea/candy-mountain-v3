import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import colors from 'tailwindcss/colors'

/** The shades Nuxt UI reads from every colour an alias names. */
export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

const IMPORT = /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?[^;]*;/g
const THEME = /@theme\b([^{;]*)\{/g

// Nuxt UI's own test: only these resolve without a scale in the product's CSS.
const isTailwindPalette = name => Object.hasOwn(colors, name) && typeof colors[name] === 'object'

/**
 * The stylesheet's text with the local files it imports inlined, so a scale declared in a partial still counts.
 * @param {string} path
 * @param {Set<string>} [seen]
 * @returns {string}
 */
export function readStylesheet(path, seen = new Set()) {
  if (seen.has(path)) return ''
  seen.add(path)
  const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  return css.replace(IMPORT, (rule, target) => {
    if (!target.startsWith('.') && !isAbsolute(target)) return rule
    const file = resolve(dirname(path), target)
    return existsSync(file) ? readStylesheet(file, seen) : rule
  })
}

/**
 * Splits out the `@theme` blocks whose variables Tailwind emits only when a utility uses them; Nuxt UI reads a scale
 * at runtime, which Tailwind never sees, so only a `@theme static` block or a plain rule declares one.
 * @param {string} css
 */
function splitDroppedThemes(css) {
  let kept = ''
  let dropped = ''
  let from = 0
  for (const match of css.matchAll(THEME)) {
    if (match.index < from) continue
    const options = match[1].trim().split(/\s+/)
    if (options.includes('static') && !options.includes('reference')) continue
    let depth = 1
    let end = match.index + match[0].length
    for (; end < css.length && depth; end++) depth += css[end] === '{' ? 1 : css[end] === '}' ? -1 : 0
    kept += css.slice(from, match.index)
    dropped += css.slice(match.index, end)
    from = end
  }
  return { kept: kept + css.slice(from), dropped }
}

const shadesOf = (css, color) => {
  const escaped = color.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new Set([...css.matchAll(new RegExp(`--color-${escaped}-(\\d+)\\s*:`, 'g'))].map(match => Number(match[1])))
}

/**
 * Every alias whose colour is neither a Tailwind palette nor a full scale the stylesheet declares.
 * @param {import('@candy-mountain/platform-sdk').ProductColors} aliases
 * @param {string} css
 * @returns {{ alias: string, color: string, missing: number[], dropped: boolean }[]}
 */
export function undeclaredColors(aliases, css) {
  const { kept, dropped } = splitDroppedThemes(css)
  return Object.entries(aliases).flatMap(([alias, color]) => {
    if (!color || isTailwindPalette(color)) return []
    const declared = shadesOf(kept, color)
    const missing = SHADES.filter(shade => !declared.has(shade))
    return missing.length ? [{ alias, color, missing, dropped: shadesOf(dropped, color).size > 0 }] : []
  })
}

/**
 * Throws naming each alias and colour the build could not resolve; Nuxt UI would silently render it colourless.
 * @param {import('@candy-mountain/platform-sdk').ProductColors} aliases
 * @param {{ path: string, css: string }} [stylesheet]
 */
export function assertDeclaredColors(aliases, stylesheet) {
  const undeclared = undeclaredColors(aliases, stylesheet?.css ?? '')
  if (!undeclared.length) return
  const lines = undeclared.map(({ alias, color, missing, dropped }) => {
    const scale = `--color-${color}-${SHADES[0]} to --color-${color}-${SHADES.at(-1)}`
    if (dropped) return `- ${alias} is "${color}", which the product stylesheet ${stylesheet?.path} declares in a @theme block Tailwind leaves out unless a utility uses it: declare ${scale} in @theme static instead.`
    if (!stylesheet) return `- ${alias} is "${color}", which is not a Tailwind palette, and no product stylesheet declares it: hand one over as platformWeb.stylesheet declaring ${scale} in @theme static.`
    if (missing.length === SHADES.length) return `- ${alias} is "${color}", which is not a Tailwind palette, and the product stylesheet ${stylesheet.path} does not declare it: add ${scale} in @theme static.`
    return `- ${alias} is "${color}", which is not a Tailwind palette, and the product stylesheet ${stylesheet.path} lacks ${missing.map(shade => `--color-${color}-${shade}`).join(', ')}.`
  })
  throw new Error(['The product theme names colours the build cannot resolve:', ...lines].join('\n'))
}

/**
 * One entry importing both sheets so the product's is compiled in the same Tailwind root, after the shell's: its
 * declarations win, and its theme, `@apply` and variants see everything the shell's sheet set up.
 * @param {string} shell
 * @param {string} product
 */
export function productStylesEntry(shell, product) {
  return `@import ${JSON.stringify(shell)};\n@import ${JSON.stringify(product)};\n`
}
