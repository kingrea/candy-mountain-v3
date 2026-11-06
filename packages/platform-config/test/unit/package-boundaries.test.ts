import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'
import { capabilityDependencyDrift, capabilityId, kindOf, workspacePackages, workspaceRoot } from '../../eslint/package-boundaries.mjs'
import { alphaDefinition } from '../fixtures/workspace/packages/cap-alpha/src/index'
import { betaDefinition } from '../fixtures/workspace/packages/cap-beta/src/index'
import { gammaDefinition } from '../fixtures/workspace/packages/cap-gamma/src/index'

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const fixtureRoot = fileURLToPath(new URL('../fixtures/workspace', import.meta.url))

const DIRECTIONS = 'Allowed: a capability or distribution -> a platform package\'s declared entries; a capability -> a dependency capability\'s root entry; never the reverse, never a relative path across package roots.'

interface Finding {
  rule: string
  message: string
}

let results: Map<string, Finding[]>

async function lintFixture(): Promise<Map<string, Finding[]>> {
  const eslint = new ESLint({
    cwd: packageRoot,
    // The fixture's own eslint.config.js stays a lint subject, not the config.
    overrideConfigFile: join(packageRoot, 'eslint.config.js'),
    ignore: false,
    overrideConfig: { settings: { 'cm-packages': { root: fixtureRoot } } },
  })
  const lint = await eslint.lintFiles([fixtureRoot])
  return new Map(lint.map(result => [
    relative(fixtureRoot, result.filePath).replaceAll('\\', '/'),
    result.messages
      .filter(message => message.fatal || message.ruleId?.startsWith('cm-packages/'))
      .map(message => ({ rule: message.ruleId ?? 'fatal', message: message.message })),
  ]))
}

function findings(file: string): Finding[] {
  const found = results.get(file)
  if (!found) throw new Error(`fixture ${file} was not linted`)
  return found
}

beforeAll(async () => {
  results = await lintFixture()
}, 60_000)

describe('package boundary lint', () => {
  it.each([
    'packages/platform-core/src/index.ts',
    'packages/platform-core/src/daemon/index.ts',
    'packages/platform-core/presets/eslint.js',
    'packages/cap-alpha/src/index.ts',
    'packages/cap-alpha/src/ok.ts',
    'packages/cap-alpha/eslint.config.js',
    'packages/cap-alpha/vitest.config.ts',
    'packages/cap-beta/src/ok.ts',
    'apps/daemon/src/index.ts',
  ])('passes %s, which uses declared entries, declared capabilities and its own files', (file) => {
    expect(findings(file)).toEqual([])
  })

  it('rejects a capability importing a platform subpath, declared or not, outside a config file', () => {
    expect(findings('packages/cap-alpha/src/bad-platform-subpath.ts')).toEqual([
      {
        rule: 'cm-packages/no-subpath-import',
        message: `Capability package @candy-mountain/cap-alpha may not import '@candy-mountain/platform-core/src/internal': @candy-mountain/platform-core declares no './src/internal' entry. ${DIRECTIONS}`,
      },
      {
        rule: 'cm-packages/no-subpath-import',
        message: `Capability package @candy-mountain/cap-alpha may not import '@candy-mountain/platform-core/eslint' here: the preset entries of @candy-mountain/platform-core are for config files (*.config.*) only. ${DIRECTIONS}`,
      },
    ])
  })

  it('rejects a capability importing a capability its package.json does not list', () => {
    expect(findings('packages/cap-alpha/src/bad-undeclared.ts')).toEqual([
      {
        rule: 'cm-packages/no-undeclared-capability-import',
        message: `Capability package @candy-mountain/cap-alpha may not import '@candy-mountain/cap-beta': @candy-mountain/cap-beta is not in its package.json dependencies, so its definition cannot name 'beta' in dependsOn either. ${DIRECTIONS}`,
      },
      {
        rule: 'cm-packages/no-unlisted-dependency',
        message: `Capability package @candy-mountain/cap-alpha may not import '@candy-mountain/cap-beta': @candy-mountain/cap-beta is not in its package.json dependencies or devDependencies. ${DIRECTIONS}`,
      },
    ])
  })

  it('lets a package reach its own declared entries by name, never an undeclared one', () => {
    expect(findings('packages/cap-alpha/src/self.ts')).toEqual([
      {
        rule: 'cm-packages/no-subpath-import',
        message: `Capability package @candy-mountain/cap-alpha may not import '@candy-mountain/cap-alpha/src/hidden': @candy-mountain/cap-alpha declares no './src/hidden' entry. ${DIRECTIONS}`,
      },
    ])
    expect(findings('apps/daemon/src/bad-wire.ts')).toEqual([
      {
        rule: 'cm-packages/no-subpath-import',
        message: `Package @fixture/daemon may not import '@candy-mountain/cap-alpha/wire': a capability package is reachable only through its root entry '@candy-mountain/cap-alpha'. ${DIRECTIONS}`,
      },
    ])
  })

  it('rejects a subpath of a declared capability', () => {
    expect(findings('packages/cap-beta/src/bad-subpath.ts')).toEqual([
      {
        rule: 'cm-packages/no-subpath-import',
        message: `Capability package @candy-mountain/cap-beta may not import '@candy-mountain/cap-alpha/src/index': a capability package is reachable only through its root entry '@candy-mountain/cap-alpha'. ${DIRECTIONS}`,
      },
    ])
  })

  it('rejects relative paths that leave the package', () => {
    expect(findings('packages/cap-alpha/src/bad-relative.ts')).toEqual([
      {
        rule: 'cm-packages/no-relative-cross-package',
        message: `Capability package @candy-mountain/cap-alpha may not import '../../cap-beta/src/index': the path leaves the package. Import @candy-mountain/cap-beta through its root entry. ${DIRECTIONS}`,
      },
      {
        rule: 'cm-packages/no-relative-cross-package',
        message: `Capability package @candy-mountain/cap-alpha may not import '../../platform-core/src/daemon/index': the path leaves the package. Import @candy-mountain/platform-core through its root entry. ${DIRECTIONS}`,
      },
      {
        rule: 'cm-packages/no-relative-cross-package',
        message: `Capability package @candy-mountain/cap-alpha may not import '../../../outside': the path leaves the package. ${DIRECTIONS}`,
      },
    ])
  })

  it('rejects a platform package importing a capability by import or re-export', () => {
    expect(findings('packages/platform-core/src/uses-capability.ts').map(f => f.rule)).toEqual([
      'cm-packages/no-capability-import-from-platform',
      'cm-packages/no-unlisted-dependency',
      'cm-packages/no-capability-import-from-platform',
      'cm-packages/no-unlisted-dependency',
    ])
    expect(findings('packages/platform-core/src/uses-capability.ts')[0]!.message).toBe(
      `Platform package @candy-mountain/platform-core may not import '@candy-mountain/cap-alpha': the platform never depends on a capability (@candy-mountain/cap-alpha). ${DIRECTIONS}`,
    )
  })

  it('holds a distribution to root entries and its own dependency list', () => {
    expect(findings('apps/daemon/src/bad.ts')).toEqual([
      {
        rule: 'cm-packages/no-subpath-import',
        message: `Package @fixture/daemon may not import '@candy-mountain/cap-alpha/src/index': a capability package is reachable only through its root entry '@candy-mountain/cap-alpha'. ${DIRECTIONS}`,
      },
      {
        rule: 'cm-packages/no-unlisted-dependency',
        message: `Package @fixture/daemon may not import '@candy-mountain/cap-beta': @candy-mountain/cap-beta is not in its package.json dependencies or devDependencies. ${DIRECTIONS}`,
      },
      {
        rule: 'cm-packages/no-subpath-import',
        message: `Package @fixture/daemon may not import '@candy-mountain/platform-core/src/internal': @candy-mountain/platform-core declares no './src/internal' entry. ${DIRECTIONS}`,
      },
    ])
  })
})

describe('workspace packages', () => {
  it('classifies packages by name and reads entries, presets and dependencies', () => {
    const packages = workspacePackages(fixtureRoot)
    expect([...packages.keys()].sort()).toEqual([
      '@candy-mountain/cap-alpha',
      '@candy-mountain/cap-beta',
      '@candy-mountain/cap-gamma',
      '@candy-mountain/platform-core',
      '@fixture/daemon',
    ])
    expect(packages.get('@candy-mountain/platform-core')).toMatchObject({
      kind: 'platform',
      capabilityId: undefined,
      entries: ['.', './daemon', './eslint', './vitest'],
      presets: ['./eslint', './vitest'],
    })
    expect(packages.get('@candy-mountain/cap-alpha')).toMatchObject({ kind: 'capability', capabilityId: 'alpha', entries: ['.', './wire'], presets: [] })
    expect(packages.get('@candy-mountain/cap-beta')).toMatchObject({
      kind: 'capability',
      capabilityId: 'beta',
      entries: ['.'],
      dependencies: ['@candy-mountain/cap-alpha', '@candy-mountain/platform-core'],
    })
    expect(packages.get('@fixture/daemon')).toMatchObject({ kind: 'other', entries: ['.'], presets: [] })
    expect(kindOf('@candy-mountain/claude-acp')).toBe('other')
    expect(capabilityId('@candy-mountain/cap-chat-claude-code')).toBe('chat-claude-code')
  })

  it('finds the workspace root above a file', () => {
    expect(workspaceRoot(`${fixtureRoot}/packages/cap-alpha/src`)).toBe(fixtureRoot)
    expect(workspaceRoot(fileURLToPath(import.meta.url))).not.toBe(fixtureRoot)
  })
})

describe('capability dependency drift', () => {
  const packages = workspacePackages(fixtureRoot)
  const pkg = (name: string) => packages.get(`@candy-mountain/cap-${name}`)!

  it('is empty when package.json dependencies and dependsOn agree, ignoring platform ids', () => {
    expect(capabilityDependencyDrift(pkg('alpha'), alphaDefinition(), packages)).toEqual([])
    expect(capabilityDependencyDrift(pkg('beta'), betaDefinition(), packages)).toEqual([])
  })

  it('names a dependency the definition omits and a dependsOn the package omits', () => {
    expect(capabilityDependencyDrift(pkg('gamma'), gammaDefinition(), packages)).toEqual([
      '@candy-mountain/cap-gamma lists @candy-mountain/cap-alpha in its dependencies but its definition\'s dependsOn omits \'alpha\'',
      '@candy-mountain/cap-gamma\'s definition depends on \'beta\' but its package.json dependencies omit @candy-mountain/cap-beta',
    ])
  })

  it('names a definition whose id is not the package\'s', () => {
    expect(capabilityDependencyDrift(pkg('alpha'), betaDefinition(), packages)).toEqual([
      '@candy-mountain/cap-alpha exports the definition of \'beta\', not \'alpha\'',
      '@candy-mountain/cap-alpha\'s definition depends on \'alpha\' but its package.json dependencies omit @candy-mountain/cap-alpha',
    ])
  })
})
