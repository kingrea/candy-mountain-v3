import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = dirname(fileURLToPath(import.meta.url))

/** Folders under src/ holding product capability code; platform start and the app factory reach them only through the product and offered services. */
const PRODUCT_FOLDERS = [
  'acp',
  'assignees',
  'bot-sessions',
  'bots',
  'chat-claude-code',
  'chat-codex',
  'decisions',
  'deployments',
  'environments',
  'issues',
  'posture',
  'sessions',
  'slack',
  'team',
  'uptime',
  'worktrees',
  'plugins/claude-code',
  'plugins/codex',
  'plugins/heroku',
  'plugins/netlify',
  'plugins/repository',
  'plugins/slack',
  'plugins/types',
]

/** The product's composition: importing either pulls in every definition. */
const PRODUCT_MODULES = ['candy-mountain', 'definitions']

const SEAM_FILES = ['platform.ts', 'app.ts']

const SPECIFIER = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

function specifiers(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map(m => m[1] ?? m[2] ?? m[3]!)
}

/** The src-relative path a relative specifier names, without extension, or null for a package import. */
function resolve(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  return relative(SRC, join(dirname(from), specifier)).split(sep).join('/').replace(/\.(ts|js|mjs)$/, '')
}

function forbidden(target: string): boolean {
  return PRODUCT_MODULES.includes(target) || PRODUCT_FOLDERS.some(folder => target === folder || target.startsWith(`${folder}/`))
}

function barrel(target: string): string | null {
  const index = join(SRC, target, 'index.ts')
  return existsSync(join(SRC, target)) && statSync(join(SRC, target)).isDirectory() && existsSync(index) ? index : null
}

/** A folder barrel counts as importing whatever it re-exports. */
function seamViolations(file: string, source = readFileSync(file, 'utf8')): string[] {
  const found: string[] = []
  for (const specifier of specifiers(source)) {
    const target = resolve(file, specifier)
    if (target === null) continue
    if (forbidden(target)) {
      found.push(`${specifier} (${target})`)
      continue
    }
    const index = barrel(target)
    if (!index) continue
    for (const reexport of specifiers(readFileSync(index, 'utf8'))) {
      const via = resolve(index, reexport)
      if (via !== null && forbidden(via)) found.push(`${specifier} re-exports ${reexport} (${via})`)
    }
  }
  return found
}

describe('the platform seam', () => {
  it.each(SEAM_FILES)('%s imports no product capability, plugin type or product composition module', (file) => {
    expect(seamViolations(join(SRC, file))).toEqual([])
  })

  it('catches direct, re-exported, side-effect and dynamic imports of product code', () => {
    const file = join(SRC, 'platform.ts')
    const source = [
      `import { BOT_SESSIONS } from './bots'`,
      `import type { UptimeScheduler } from './uptime/scheduler'`,
      `export { CANDY_MOUNTAIN } from './candy-mountain'`,
      `import './slack/definition'`,
      `const codex = await import('./plugins/codex')`,
      `import { createPluginTypeRegistry } from './plugins'`,
      `import { createPluginTypeRegistry as registry } from './plugins/registry'`,
      `import { Hono } from 'hono'`,
    ].join('\n')

    const found = seamViolations(file, source)
    expect(found.slice(0, 5)).toEqual([
      './bots (bots)',
      './uptime/scheduler (uptime/scheduler)',
      './candy-mountain (candy-mountain)',
      './slack/definition (slack/definition)',
      './plugins/codex (plugins/codex)',
    ])
    expect(found.slice(5)).toContain('./plugins re-exports ./codex (plugins/codex)')
    expect(found.some(f => f.startsWith('./plugins/registry'))).toBe(false)
  })
})
