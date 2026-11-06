import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = dirname(fileURLToPath(import.meta.url))

/** Every folder under src/; a new one is classified here so the platform line stays a decision. */
const PLATFORM_FOLDERS = [
  'activity',
  'agent-mcp',
  'auth',
  'capabilities',
  'db',
  'grants',
  'modules',
  'notifications',
  'overview',
  'platform-agent',
  'plugins',
  'registry',
  'routes',
  'secrets',
  'settings',
  'testing',
  'threads',
  'workspace-modules',
  'workspaces',
]

/** Packages this one may import: the SDK, the runtime config and the libraries the daemon runs on, never an app or a capability package. */
const ALLOWED_PACKAGES = /^(node:|@candy-mountain\/platform-sdk(\/daemon)?$|@candy-mountain\/platform-daemon$|@candy-mountain\/platform-config$|@hono\/node-server$|@agentclientprotocol\/sdk|@mastra\/|better-sqlite3|drizzle-orm|drizzle-kit|hono|zod|vitest)/

const PACKAGE_ROOT = dirname(SRC)

/** Statements at column 0 and dynamic imports; text inside a test title never starts a line. */
const SPECIFIER = /^(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|^import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm

function specifiers(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map(m => m[1] ?? m[2] ?? m[3]!)
}

/** A relative specifier that leaves the package, or a package that is not the SDK or a runtime library. */
function violations(file: string, source = readFileSync(file, 'utf8')): string[] {
  return specifiers(source).filter((specifier) => {
    if (specifier.startsWith('.')) return relative(PACKAGE_ROOT, join(dirname(file), specifier)).startsWith('..')
    return !ALLOWED_PACKAGES.test(specifier)
  })
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? sources(path) : /\.(ts|mjs)$/.test(entry.name) ? [path] : []
  })
}

describe('the platform package', () => {
  it('classifies every folder under src/', () => {
    const folders = readdirSync(SRC, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
    expect(folders.filter(f => !PLATFORM_FOLDERS.includes(f))).toEqual([])
  })

  it('imports no app, product or capability code', () => {
    // This file's own fixture strings would be read as imports.
    const found = sources(SRC).filter(file => file !== fileURLToPath(import.meta.url)).flatMap(file => violations(file).map(v => `${relative(SRC, file).split(sep).join('/')}: ${v}`))
    expect(found).toEqual([])
  })

  it('catches relative escapes, app imports and capability packages', () => {
    const file = join(SRC, 'platform.ts')
    const source = [
      `import { BOT_SESSIONS } from '../../../apps/daemon/src/bots'`,
      `import type { Product } from '@candy-mountain/daemon'`,
      `export { slackDefinition } from '@candy-mountain/cap-slack'`,
      `import '@candy-mountain/candy-mountain'`,
      `const codex = await import('../../apps/daemon/src/plugins/codex')`,
      `import { Hono } from 'hono'`,
      `import { serviceKey } from '@candy-mountain/platform-sdk/daemon'`,
      `import { startPlatform } from './platform'`,
    ].join('\n')
    expect(violations(file, source)).toEqual([
      '../../../apps/daemon/src/bots',
      '@candy-mountain/daemon',
      '@candy-mountain/cap-slack',
      '@candy-mountain/candy-mountain',
      '../../apps/daemon/src/plugins/codex',
    ])
  })
})
