import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { chatFamilyComponents, chatFamilyPieces, chatFamilyRegister } from '../../app/utils/chatFamilies'

const LAYER = fileURLToPath(new URL('../..', import.meta.url))
const GUARD = relative(LAYER, fileURLToPath(import.meta.url))

// The chat layer is platform: it may not name a product family, capability or protocol.
const PRODUCT_WORDS = [/claude/i, /codex/i, /\bacp\b/i, /\bbots?\b/i, /worktree/i]
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
  for (const dir of ['app', 'test']) {
    for (const path of sourceFiles(join(LAYER, dir))) {
      const file = relative(LAYER, path)
      if (file === GUARD) continue
      readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
        if (pattern.test(line.replace(ICON_NAMES, ''))) found.push(`${file}:${index + 1}: ${line.trim()}`)
      })
    }
  }
  return found
}

const piece = (name: string) => defineComponent({ name, render: () => null })

describe('chatFamilyRegister', () => {
  it('keeps the pieces of every contributing layer in registration order, by slot', () => {
    const bar = piece('bar')
    const card = piece('card')
    const other = piece('other')
    chatFamilyRegister('alpha', { id: 'first', promptBar: bar })
    chatFamilyRegister('alpha', { id: 'second', aboveTranscript: card, promptBar: other })
    expect(chatFamilyPieces('alpha').map(pieces => pieces.id)).toEqual(['first', 'second'])
    expect(chatFamilyComponents('alpha', 'promptBar')).toEqual([bar, other])
    expect(chatFamilyComponents('alpha', 'aboveTranscript')).toEqual([card])
  })

  it('replaces a layer\'s pieces when it registers again', () => {
    const late = piece('late')
    chatFamilyRegister('beta', { id: 'layer', promptBar: piece('early') })
    chatFamilyRegister('beta', { id: 'layer', promptBar: late })
    expect(chatFamilyComponents('beta', 'promptBar')).toEqual([late])
  })

  it('has nothing for an unknown or missing family', () => {
    expect(chatFamilyPieces('gamma')).toEqual([])
    expect(chatFamilyComponents(undefined, 'promptBar')).toEqual([])
    expect(chatFamilyComponents(null, 'aboveTranscript')).toEqual([])
  })
})

describe('the chat layer names no product family', () => {
  it('mentions no session family, capability, protocol, bot or worktree of the product', () => {
    expect(offences(new RegExp(PRODUCT_WORDS.map(word => word.source).join('|'), 'i'))).toEqual([])
  })
})
