import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AcpSessionEvent } from '../events'
import type { FamilyBins, FamilyEntry } from '../families'
import type { AcpSession } from '../session'

const require = createRequire(import.meta.url)
const claudeAcpDir = dirname(require.resolve('@candy-mountain/claude-acp/package.json'))

export const FAKE_ACP_AGENT = fileURLToPath(new URL('./fake-acp-agent.mjs', import.meta.url))
export const CLAUDE_FIXTURE = join(claudeAcpDir, 'src', 'test-support', 'claude-fixture.mjs')

/** The shim from TypeScript source through tsx, so the tests need no prior build. */
export function claudeShimFromSource(): FamilyEntry {
  const loader = pathToFileURL(require.resolve('tsx')).href
  return { command: process.execPath, args: ['--import', loader, join(claudeAcpDir, 'src', 'cli.ts')] }
}

export const fakeBins: FamilyBins = {
  claudeShim: claudeShimFromSource(),
  codexAdapter: { command: process.execPath, args: [FAKE_ACP_AGENT] },
}

export interface TempHome {
  root: string
  cwd: string
  configHome: string
  cleanup(): void
}

export function createTempHome(prefix = 'cm-acp-'): TempHome {
  const root = mkdtempSync(join(tmpdir(), prefix))
  return { root, cwd: join(root, 'checkout'), configHome: join(root, 'config-home'), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/** A `claude` executable that runs the lifted fixture, with FIXTURE_* env passed through the shim untouched. */
export function fakeClaude(dir: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  const path = join(dir, 'claude')
  writeFileSync(path, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(CLAUDE_FIXTURE)} "$@"\n`)
  chmodSync(path, 0o755)
  return path
}

export const textOf = (events: AcpSessionEvent[]) => events.flatMap(event => (event.kind === 'text' && event.role === 'agent' ? [event.text] : []))

export function collect(session: AcpSession, into: AcpSessionEvent[] = []): AcpSessionEvent[] {
  session.subscribe(event => into.push(event))
  return into
}

export function waitForEvent<K extends AcpSessionEvent['kind']>(session: AcpSession, kind: K, timeoutMs = 10_000): Promise<Extract<AcpSessionEvent, { kind: K }>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`No ${kind} event within ${timeoutMs}ms`)) }, timeoutMs)
    const unsubscribe = session.subscribe((event) => {
      if (event.kind !== kind) return
      clearTimeout(timer)
      unsubscribe()
      resolve(event as Extract<AcpSessionEvent, { kind: K }>)
    })
  })
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}

export async function waitForGone(pid: number, timeoutMs = 5000): Promise<boolean> {
  const started = Date.now()
  while (processAlive(pid)) {
    if (Date.now() - started > timeoutMs) return false
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return true
}

export const hasBuiltShim = existsSync(join(claudeAcpDir, 'dist', 'cli.mjs'))
