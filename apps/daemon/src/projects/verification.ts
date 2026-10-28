import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { PathVerification } from '@candy-mountain/shared'
import { ProjectError } from './errors'

const run = promisify(execFile)
const GIT_TIMEOUT_MS = 5000

export function normaliseProjectPath(raw: string): string {
  const trimmed = raw.trim()
  const expanded = trimmed === '~' ? homedir() : trimmed.startsWith('~/') ? join(homedir(), trimmed.slice(2)) : trimmed
  // The daemon's working directory means nothing to the person typing the path.
  if (!isAbsolute(expanded)) throw new ProjectError('invalid_path', `Project path must be absolute: ${raw}`)
  return resolve(expanded)
}

export async function verifyPath(path: string): Promise<PathVerification> {
  const checkedAt = new Date().toISOString()
  if (!(await isDirectory(path))) {
    return { checkedAt, pathExists: false, hasBeads: false, isGitRepo: false, hasRemote: false, remoteName: null, remoteUrl: null }
  }

  const [hasBeads, isGitRepo] = await Promise.all([isDirectory(join(path, '.beads')), isInsideWorkTree(path)])
  const remote = isGitRepo ? await primaryRemote(path) : null
  return {
    checkedAt,
    pathExists: true,
    hasBeads,
    isGitRepo,
    hasRemote: remote !== null,
    remoteName: remote?.name ?? null,
    remoteUrl: remote?.url ?? null,
  }
}

export async function requireExistingDirectory(path: string): Promise<void> {
  if (!(await isDirectory(path))) {
    throw new ProjectError('path_not_found', `Project path does not exist or is not a directory: ${path}`)
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  }
  catch {
    return false
  }
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], {
      timeout: GIT_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    return stdout.trim()
  }
  catch {
    return null
  }
}

async function isInsideWorkTree(path: string): Promise<boolean> {
  return (await git(path, ['rev-parse', '--is-inside-work-tree'])) === 'true'
}

async function primaryRemote(path: string): Promise<{ name: string, url: string } | null> {
  const names = (await git(path, ['remote']))?.split('\n').filter(Boolean) ?? []
  const name = names.includes('origin') ? 'origin' : names[0]
  if (!name) return null
  const url = await git(path, ['remote', 'get-url', name])
  return url ? { name, url: redactCredentials(url) } : null
}

// Remote URLs can embed access tokens, and this value is sent to the browser.
function redactCredentials(url: string): string {
  try {
    const parsed = new URL(url)
    const httpLike = parsed.protocol === 'http:' || parsed.protocol === 'https:'
    if (!parsed.password && !(httpLike && parsed.username)) return url
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  }
  catch {
    return url
  }
}
