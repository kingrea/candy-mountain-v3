import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Project } from '@candy-mountain/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PlatformDatabase } from '../db'
import { createProject } from '../projects/projects'
import { createTempDataDir, openTestDatabase, type TempDataDir } from '../testing'
import { createGitRunner } from './git'
import { inspectWorktree } from './inspect'
import { DEPENDENCY_OUTPUT_TAIL_BYTES, dependencyInstallState, detectPackageManager, type DependencyInstaller, installEnv, installWorktreeDependencies } from './install'
import { createWorktreePool, type WorktreePool } from './pool'
import { createTempGitRepo, TEST_GIT_ENV, type TempGitRepo } from './test-repo'

const dirs: string[] = []
function tempDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'candy-mountain-install-'))
  dirs.push(dir)
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const MANIFEST = JSON.stringify({ name: 'fixture', version: '1.0.0', private: true })
const manifest = (fields: Record<string, unknown>) => JSON.stringify({ name: 'fixture', version: '1.0.0', private: true, ...fields })

describe('detectPackageManager', () => {
  it('skips a checkout without package.json', () => {
    expect(detectPackageManager(tempDir({ 'README.md': 'hi' }))).toEqual({ kind: 'skip', reason: expect.stringContaining('No package.json') })
  })

  it('skips a package.json without a lockfile', () => {
    expect(detectPackageManager(tempDir({ 'package.json': manifest({ packageManager: 'pnpm@9.0.0' }) }))).toEqual({ kind: 'skip', reason: expect.stringContaining('no pnpm-lock.yaml') })
  })

  it('picks pnpm from pnpm-lock.yaml, offline first then online', () => {
    expect(detectPackageManager(tempDir({ 'package.json': MANIFEST, 'pnpm-lock.yaml': '' }))).toEqual({
      kind: 'install',
      plan: {
        packageManager: 'pnpm',
        lockfile: 'pnpm-lock.yaml',
        commands: [
          ['pnpm', 'install', '--offline', '--frozen-lockfile'],
          ['pnpm', 'install', '--frozen-lockfile', '--prefer-offline'],
        ],
      },
    })
  })

  it.each(['package-lock.json', 'npm-shrinkwrap.json'])('picks npm ci from %s', (lockfile) => {
    expect(detectPackageManager(tempDir({ 'package.json': MANIFEST, [lockfile]: '{}' }))).toEqual({
      kind: 'install',
      plan: { packageManager: 'npm', lockfile, commands: [['npm', 'ci', '--prefer-offline', '--no-audit', '--no-fund']] },
    })
  })

  it('picks yarn classic or berry flags from the yarn.lock format', () => {
    const classic = detectPackageManager(tempDir({ 'package.json': MANIFEST, 'yarn.lock': '# yarn lockfile v1\n' }))
    expect(classic).toMatchObject({ kind: 'install', plan: { packageManager: 'yarn', commands: [['yarn', 'install', '--frozen-lockfile', '--prefer-offline', '--non-interactive']] } })
    const berry = detectPackageManager(tempDir({ 'package.json': MANIFEST, 'yarn.lock': '__metadata:\n  version: 8\n' }))
    expect(berry).toMatchObject({ kind: 'install', plan: { packageManager: 'yarn', commands: [['yarn', 'install', '--immutable']] } })
  })

  it('breaks a tie between lockfiles with the packageManager field', () => {
    const files = { 'pnpm-lock.yaml': '', 'yarn.lock': '', 'package-lock.json': '{}' }
    expect(detectPackageManager(tempDir({ ...files, 'package.json': manifest({ packageManager: 'npm@10.8.0' }) }))).toMatchObject({ plan: { packageManager: 'npm' } })
    expect(detectPackageManager(tempDir({ ...files, 'package.json': manifest({ packageManager: 'yarn@1.22.22+sha512.abc' }) }))).toMatchObject({ plan: { packageManager: 'yarn' } })
    expect(detectPackageManager(tempDir({ ...files, 'package.json': MANIFEST }))).toMatchObject({ plan: { packageManager: 'pnpm' } })
    expect(detectPackageManager(tempDir({ 'yarn.lock': '', 'package-lock.json': '{}', 'package.json': MANIFEST }))).toMatchObject({ plan: { packageManager: 'yarn' } })
  })

  it('follows the lockfile when packageManager names a manager without one', () => {
    expect(detectPackageManager(tempDir({ 'package-lock.json': '{}', 'package.json': manifest({ packageManager: 'pnpm@9.0.0' }) }))).toMatchObject({ plan: { packageManager: 'npm' } })
  })

  it('still detects from the lockfile when package.json is not valid JSON', () => {
    expect(detectPackageManager(tempDir({ 'pnpm-lock.yaml': '', 'package.json': '{ nope' }))).toMatchObject({ kind: 'install', plan: { packageManager: 'pnpm' } })
  })
})

describe('dependencyInstallState', () => {
  it('maps the lease outcome to the surface instruction state', () => {
    const at = '2026-01-01T00:00:00.000Z'
    expect(dependencyInstallState({ status: 'installed', output: '', checkedAt: at })).toBe(true)
    expect(dependencyInstallState({ status: 'failed', output: 'boom', checkedAt: at })).toBe('failed')
    expect(dependencyInstallState({ status: 'skipped', output: 'none', checkedAt: at })).toBe(false)
    expect(dependencyInstallState(null)).toBe(false)
  })
})

describe('installEnv', () => {
  it('passes the basics through and drops secrets', () => {
    const env = installEnv({ PATH: '/bin', HOME: '/home/x', HTTPS_PROXY: 'http://proxy:3128', NPM_TOKEN: 's', GITHUB_TOKEN: 's', ANTHROPIC_API_KEY: 's', CM_SECRETS_KEY: 's', AWS_SECRET_ACCESS_KEY: 's', NODE_OPTIONS: '--require x' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/x', HTTPS_PROXY: 'http://proxy:3128', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', NO_UPDATE_NOTIFIER: '1', npm_config_update_notifier: 'false', NO_COLOR: '1', FORCE_COLOR: '0' })
  })
})

describe('installWorktreeDependencies with stand-in package managers', () => {
  // Stand-in binaries keep these cases deterministic; the pool tests below use the real pnpm.
  function fakeBin(scripts: Record<string, string>): string {
    const bin = tempDir()
    for (const [name, body] of Object.entries(scripts)) {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
      chmodSync(join(bin, name), 0o755)
    }
    return bin
  }
  const pnpmProject = () => tempDir({ 'package.json': MANIFEST, 'pnpm-lock.yaml': '' })
  const envWith = (bin: string, extra: NodeJS.ProcessEnv = {}) => ({ PATH: `${bin}:/usr/bin:/bin`, HOME: tmpdir(), ...extra })

  it('falls back to an online pnpm install when the offline one fails', async () => {
    const bin = fakeBin({ pnpm: 'case "$*" in *--offline*) echo "ERR_PNPM_NO_OFFLINE_TARBALL missing from store" >&2; exit 1;; esac\nmkdir node_modules\necho installed online' })
    const dir = pnpmProject()
    const result = await installWorktreeDependencies(dir, { env: envWith(bin) })
    expect(result.status).toBe('installed')
    expect(result.packageManager).toBe('pnpm')
    expect(result.output).toContain('$ pnpm install --offline --frozen-lockfile')
    expect(result.output).toContain('ERR_PNPM_NO_OFFLINE_TARBALL')
    expect(result.output).toContain('$ pnpm install --frozen-lockfile --prefer-offline')
    expect(result.output).toContain('installed online')
    expect(existsSync(join(dir, 'node_modules'))).toBe(true)
  })

  it('records failure with only the tail of a long output', async () => {
    const bin = fakeBin({ pnpm: 'i=0; while [ $i -lt 400 ]; do echo "line $i of noisy output"; i=$((i+1)); done\necho "FINAL ERROR" >&2\nexit 3' })
    const result = await installWorktreeDependencies(pnpmProject(), { env: envWith(bin) })
    expect(result.status).toBe('failed')
    expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(DEPENDENCY_OUTPUT_TAIL_BYTES + 3)
    expect(result.output.startsWith('…')).toBe(true)
    expect(result.output).toContain('FINAL ERROR')
    expect(result.output.trimEnd().endsWith('exited with code 3')).toBe(true)
  })

  it('runs with the curated environment only', async () => {
    const bin = fakeBin({ npm: 'env' })
    const result = await installWorktreeDependencies(tempDir({ 'package.json': MANIFEST, 'package-lock.json': '{}' }), { env: envWith(bin, { NPM_TOKEN: 'leak', CM_SECRETS_KEY: 'leak' }) })
    expect(result.status).toBe('installed')
    expect(result.output).toContain('COREPACK_ENABLE_DOWNLOAD_PROMPT=0')
    expect(result.output).not.toContain('leak')
  })

  it('reports a package manager missing from PATH once', async () => {
    const result = await installWorktreeDependencies(pnpmProject(), { env: envWith(tempDir()) })
    expect(result.status).toBe('failed')
    expect(result.output).toContain('pnpm is not installed or not on the daemon\'s PATH')
    expect(result.output.match(/\$ pnpm/g)).toHaveLength(1)
  })

  it('kills the whole process group on timeout and does not retry', async () => {
    const pidFile = join(tempDir(), 'child.pid')
    const bin = fakeBin({ pnpm: `sleep 30 &\necho $! > "${pidFile}"\nsleep 30` })
    const started = Date.now()
    const result = await installWorktreeDependencies(pnpmProject(), { env: envWith(bin), timeoutMs: 700 })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(result.status).toBe('failed')
    expect(result.output).toMatch(/timed out after \d+s/)
    expect(result.output.match(/\$ pnpm/g)).toHaveLength(1)
    const grandchild = Number(readFileSync(pidFile, 'utf8'))
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(() => process.kill(grandchild, 0)).toThrow()
  }, 10_000)

  it('skips without running anything when there is no manifest', async () => {
    expect(await installWorktreeDependencies(tempDir({ 'README.md': 'hi' }), { env: envWith(tempDir()) })).toEqual({ status: 'skipped', packageManager: null, output: expect.stringContaining('No package.json') })
  })
})

const hasPnpm = (() => {
  try {
    execFileSync('pnpm', ['--version'], { cwd: tmpdir(), stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
})()

describe('worktree pool dependency installs', () => {
  let database: PlatformDatabase
  let data: TempDataDir
  let repo: TempGitRepo
  let project: Project
  const gitRunner = createGitRunner({ env: TEST_GIT_ENV })

  beforeEach(() => {
    database = openTestDatabase()
    data = createTempDataDir()
    repo = createTempGitRepo()
  })
  afterEach(() => {
    database.close()
    repo.cleanup()
    data.cleanup()
  })

  async function poolFor(installer?: DependencyInstaller): Promise<WorktreePool> {
    project = await createProject(database.db, { name: 'alpha', source: { kind: 'local-path', path: repo.clone } })
    return createWorktreePool({ db: database.db, paths: { worktrees: join(data.root, 'worktrees') }, git: gitRunner, installer })
  }

  function pushFiles(files: Record<string, string>) {
    const work = join(repo.root, 'files-pusher')
    repo.git(repo.root, 'clone', '--quiet', '--branch', 'main', repo.origin, work)
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(work, name)), { recursive: true })
      writeFileSync(join(work, name), content)
    }
    repo.git(work, 'add', '-A')
    repo.git(work, 'commit', '--quiet', '-m', 'add package files')
    repo.git(work, 'push', '--quiet', 'origin', 'main')
  }

  const LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      local-dep:
        specifier: link:./local-dep
        version: link:local-dep
`
  const pnpmFiles = {
    '.gitignore': 'node_modules\n',
    'package.json': manifest({ dependencies: { 'local-dep': 'link:./local-dep' } }),
    'pnpm-lock.yaml': LOCKFILE,
    'local-dep/package.json': JSON.stringify({ name: 'local-dep', version: '1.0.0' }),
  }

  it.skipIf(!hasPnpm)('installs a pnpm repo\'s dependencies into a new worktree', async () => {
    pushFiles(pnpmFiles)
    const pool = await poolFor()

    const lease = await pool.acquire({ projectId: project.id, holder: { kind: 'session', id: 's1' }, baseBranch: 'main' })

    expect(lstatSync(join(lease.path, 'node_modules', 'local-dep')).isSymbolicLink()).toBe(true)
    expect(lease.dependencies).toEqual({ status: 'installed', output: expect.stringContaining('$ pnpm install --offline --frozen-lockfile'), checkedAt: expect.any(String) })
    expect(pool.get(lease.id)).toEqual(lease)
    expect(dependencyInstallState(lease.dependencies)).toBe(true)
    expect((await inspectWorktree(gitRunner, lease.path)).unsafeReason).toBeNull()
  }, 60_000)

  it.skipIf(!hasPnpm)('records a failed install without blocking the lease', async () => {
    pushFiles({ ...pnpmFiles, 'package.json': manifest({ dependencies: { 'local-dep': 'link:./local-dep', 'candy-mountain-missing-pkg': '1.0.0' } }) })
    const pool = await poolFor()

    const lease = await pool.acquire({ projectId: project.id, holder: { kind: 'session', id: 's1' }, baseBranch: 'main' })

    expect(lease.state).toBe('active')
    expect(lease.dependencies?.status).toBe('failed')
    expect(lease.dependencies?.output).toContain('ERR_PNPM_OUTDATED_LOCKFILE')
    expect(lease.dependencies?.output).toContain('$ pnpm install --frozen-lockfile --prefer-offline')
    expect(dependencyInstallState(lease.dependencies)).toBe('failed')
    expect(pool.list(project.id)).toEqual([lease])
    expect(await pool.resume({ kind: 'session', id: 's1' })).toMatchObject({ id: lease.id, dependencies: { status: 'failed' } })
  }, 60_000)

  it('records skipped for a repository without a package manifest', async () => {
    const pool = await poolFor()
    const lease = await pool.acquire({ projectId: project.id, holder: { kind: 'session', id: 's1' }, baseBranch: 'main' })
    expect(lease.dependencies).toEqual({ status: 'skipped', output: expect.stringContaining('No package.json'), checkedAt: expect.any(String) })
    expect(pool.get(lease.id)?.dependencies?.status).toBe('skipped')
    expect(dependencyInstallState(lease.dependencies)).toBe(false)
  }, 20_000)

  it('records a failure even when the installer throws', async () => {
    const pool = await poolFor(async () => {
      throw new Error('pnpm exploded')
    })
    const lease = await pool.acquire({ projectId: project.id, holder: { kind: 'session', id: 's1' }, baseBranch: 'main' })
    expect(lease).toMatchObject({ state: 'active', dependencies: { status: 'failed', output: expect.stringContaining('pnpm exploded') } })
  }, 20_000)

  it('can skip the install, and reinstalls when resume adds a vanished directory back', async () => {
    const calls: string[] = []
    const pool = await poolFor(async (dir) => {
      calls.push(dir)
      return { status: 'installed', packageManager: 'pnpm', output: 'ok' }
    })
    const holder = { kind: 'session' as const, id: 's1' }
    const lease = await pool.acquire({ projectId: project.id, holder, baseBranch: 'main', installDependencies: false })
    expect(lease.dependencies).toBeNull()
    expect(calls).toEqual([])

    expect((await pool.resume(holder))?.dependencies).toBeNull()
    expect(calls).toEqual([])

    rmSync(lease.path, { recursive: true, force: true })
    const resumed = await pool.resume(holder)
    expect(calls).toEqual([lease.path])
    expect(resumed?.dependencies).toMatchObject({ status: 'installed', output: 'ok' })

    expect((await pool.installDependencies(lease.id, { timeoutMs: 1000 })).dependencies?.status).toBe('installed')
    expect(calls).toHaveLength(2)
  }, 20_000)
})
