import { chmodSync, existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const claudeAcpDir = dirname(require.resolve('@candy-mountain/claude-acp/package.json'))

export const FAKE_ACP_AGENT = fileURLToPath(new URL('./fake-acp-agent.mjs', import.meta.url))
export const CLAUDE_FIXTURE = join(claudeAcpDir, 'src', 'test-support', 'claude-fixture.mjs')

/** The shim from TypeScript source through tsx, so the tests need no prior build. */
const claudeShimFromSource = { command: process.execPath, args: ['--import', pathToFileURL(require.resolve('tsx')).href, join(claudeAcpDir, 'src', 'cli.ts')] }

/** The `bins` acp launches from: the claude shim from source and the fake ACP agent as the codex adapter. */
export const fakeBins = {
  claudeShim: claudeShimFromSource,
  codexAdapter: { command: process.execPath, args: [FAKE_ACP_AGENT] },
}

/** A `claude` executable that runs the lifted fixture, with FIXTURE_* env passed through the shim untouched. */
export function fakeClaude(dir: string): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  const path = join(dir, 'claude')
  writeFileSync(path, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(CLAUDE_FIXTURE)} "$@"\n`)
  chmodSync(path, 0o755)
  return path
}

export const hasBuiltShim = existsSync(join(claudeAcpDir, 'dist', 'cli.mjs'))
