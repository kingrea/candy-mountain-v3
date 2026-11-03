import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

const webRoot = fileURLToPath(new URL('../..', import.meta.url))
const CORE_DIRS = ['app', 'shared']
const WORD = /\b[Pp]rojects?\b/

// Vue template AST node types, from @vue/compiler-core.
const ELEMENT = 1
const TEXT = 2
const INTERPOLATION = 5
const ATTRIBUTE = 6
const DIRECTIVE = 7

interface TemplateNode {
  type: number
  content?: string | { content: string }
  children?: TemplateNode[]
  props?: { type: number, name: string, value?: { content: string }, exp?: { content: string } }[]
}

// Bare lowercase strings are ids, keys, routes and scope values; prose has a space or a capital.
const isCopy = (text: string) => WORD.test(text) && (/\s/.test(text) || /\bProjects?\b/.test(text))

function scriptStrings(code: string): string[] {
  const strings: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node)) strings.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile('copy.ts', code, ts.ScriptTarget.Latest, true))
  return strings
}

function templateCopy(node: TemplateNode, found: string[]) {
  if (node.type === TEXT && typeof node.content === 'string' && WORD.test(node.content)) found.push(node.content.trim())
  if (node.type === INTERPOLATION && typeof node.content === 'object') found.push(...scriptStrings(`(${node.content.content})`).filter(isCopy))
  if (node.type === ELEMENT) {
    for (const prop of node.props ?? []) {
      if (prop.type === ATTRIBUTE && prop.value && isCopy(prop.value.content)) found.push(prop.value.content)
      if (prop.type === DIRECTIVE && prop.exp) found.push(...scriptStrings(`(${prop.exp.content})`).filter(isCopy))
    }
  }
  node.children?.forEach(child => templateCopy(child, found))
}

function copyIn(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  if (!file.endsWith('.vue')) return scriptStrings(source).filter(isCopy)
  const { descriptor } = parse(source, { filename: file })
  const found = [descriptor.script, descriptor.scriptSetup].flatMap(block => (block ? scriptStrings(block.content).filter(isCopy) : []))
  if (descriptor.template?.ast) templateCopy(descriptor.template.ast as unknown as TemplateNode, found)
  return found
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(vue|ts)$/.test(entry.name) ? [path] : []
  })
}

describe('platform copy', () => {
  it('never writes the scope word itself; it reads SCOPE', () => {
    const offenders = CORE_DIRS.flatMap(dir => sourceFiles(join(webRoot, dir)))
      .flatMap(file => copyIn(file).map(text => `${relative(webRoot, file)}: ${text}`))
    expect(offenders).toEqual([])
  })

  it('catches the word in template text, attributes and script strings', () => {
    const file = join(webRoot, 'test/fixtures/scope-copy/Offender.vue')
    expect(copyIn(file)).toEqual(['Manage projects', 'Select a project', 'No projects yet', 'Project'])
  })
})
