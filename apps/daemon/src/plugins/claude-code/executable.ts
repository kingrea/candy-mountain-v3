import { accessSync, constants, mkdtempSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import type { ClaudeExecutableResponse } from '@candy-mountain/shared'
import { CLAUDE_COMMAND, claudeCliEnv, runClaude } from './cli'

export const CLAUDE_VERSION_ARGS = ['--version'] as const

/** Fixed sentences for the admin; none quotes CLI output. */
export const EXECUTABLE_REASONS = {
  notFound: 'No claude executable was found on the daemon\'s PATH or in the usual install directories.',
  missing: 'There is no file at that path.',
  notExecutable: 'The file at that path is not executable.',
  failed: 'The executable was found but `claude --version` did not run.',
} as const

/** Where the stock installer and package managers put `claude` when the daemon's PATH does not include it. */
export function claudeFallbackDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME || homedir()
  return [join(home, '.local', 'bin'), join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin']
}

function executableAt(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  }
  catch {
    return false
  }
}

export interface FoundClaude {
  path: string
  onPath: boolean
}

/** PATH first, in order, then the fallback directories; undefined when no executable `claude` exists in any of them. */
export function findClaudeExecutable(env: NodeJS.ProcessEnv = process.env): { found: FoundClaude | undefined, searched: string[] } {
  const pathDirs = (env.PATH ?? '').split(delimiter).filter(Boolean)
  const searched: string[] = []
  for (const dir of pathDirs) {
    searched.push(dir)
    const candidate = join(dir, CLAUDE_COMMAND)
    if (executableAt(candidate)) return { found: { path: candidate, onPath: true }, searched }
  }
  for (const dir of claudeFallbackDirs(env)) {
    if (searched.includes(dir)) continue
    searched.push(dir)
    const candidate = join(dir, CLAUDE_COMMAND)
    if (executableAt(candidate)) return { found: { path: candidate, onPath: false }, searched }
  }
  return { found: undefined, searched }
}

const VERSION_PATTERN = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/

/** Runs `<path> --version` in a throwaway config directory so the probe never touches a real login. */
export async function readClaudeVersion(path: string, { env = process.env, timeoutMs, signal }: { env?: NodeJS.ProcessEnv, timeoutMs?: number, signal?: AbortSignal } = {}): Promise<{ ok: true, version?: string } | { ok: false }> {
  const configDir = mkdtempSync(join(tmpdir(), 'candy-mountain-claude-probe-'))
  try {
    const run = await runClaude(CLAUDE_VERSION_ARGS, { command: path, cwd: configDir, env: claudeCliEnv({ configDir, base: env }), timeoutMs, signal })
    if (run.kind !== 'exited' || run.code !== 0) return { ok: false }
    const version = VERSION_PATTERN.exec(run.stdout)?.[0]
    return version ? { ok: true, version } : { ok: true }
  }
  finally {
    rmSync(configDir, { recursive: true, force: true })
  }
}

export interface ProbeClaudeExecutableOptions {
  /** An explicit absolute path to check instead of searching. */
  path?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  signal?: AbortSignal
}

export async function probeClaudeExecutable({ path, env = process.env, timeoutMs, signal }: ProbeClaudeExecutableOptions = {}): Promise<ClaudeExecutableResponse> {
  let candidate: FoundClaude
  let searched: string[]
  if (path !== undefined) {
    if (!isAbsolute(path)) throw new Error('path must be absolute')
    searched = [path]
    try {
      statSync(path)
    }
    catch {
      return { found: false, reason: EXECUTABLE_REASONS.missing, searched }
    }
    if (!executableAt(path)) return { found: false, reason: EXECUTABLE_REASONS.notExecutable, searched }
    candidate = { path, onPath: false }
  }
  else {
    const result = findClaudeExecutable(env)
    searched = result.searched
    if (!result.found) return { found: false, reason: EXECUTABLE_REASONS.notFound, searched }
    candidate = result.found
  }
  const version = await readClaudeVersion(candidate.path, { env, timeoutMs, signal })
  if (!version.ok) return { found: false, reason: EXECUTABLE_REASONS.failed, searched }
  return version.version ? { found: true, ...candidate, version: version.version } : { found: true, ...candidate }
}
