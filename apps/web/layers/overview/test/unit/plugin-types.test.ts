import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const LAYER = fileURLToPath(new URL('../..', import.meta.url))
const GUARD = relative(LAYER, fileURLToPath(import.meta.url))

// The overview is platform: a product's plugin types contribute their cards through registerProjectHomeCard instead.
const PRODUCT_WORDS = [
  /repositor/i,
  /claude/i,
  /codex/i,
  /netlify/i,
  /heroku/i,
  /slack/i,
  /verification/i,
  /source\.path/,
  /pathExists|remoteUrl|remoteName|isGitRepo|hasBeads/,
]
// An icon name is not a reference.
const ICON_NAMES = /\bi-lucide-[a-z\d-]+/g

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.(ts|vue)$/.test(name)) yield path
  }
}

function offences(pattern: RegExp): string[] {
  const found: string[] = []
  for (const path of sourceFiles(LAYER)) {
    const file = relative(LAYER, path)
    if (file === GUARD) continue
    readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
      if (pattern.test(line.replace(ICON_NAMES, ''))) found.push(`${file}:${index + 1}: ${line.trim()}`)
    })
  }
  return found
}

describe('the overview layer names no plugin type', () => {
  it('mentions no product plugin type, repository source or path verification', () => {
    expect(offences(new RegExp(PRODUCT_WORDS.map(word => word.source).join('|'), 'i'))).toEqual([])
  })
})
