import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'
import { capabilityDependencyDrift, capabilityId, capabilityKindProblems, kindOf, workspacePackages, workspaceRoot } from '../../eslint/package-boundaries.mjs'
import { alphaDefinition } from '../fixtures/workspace/packages/cap-alpha/src/index'
import { betaDefinition } from '../fixtures/workspace/packages/cap-beta/src/index'
import { epsilonDefinition } from '../fixtures/workspace/packages/cap-epsilon/src/index'
import { gammaDefinition } from '../fixtures/workspace/packages/cap-gamma/src/index'
import { deltaDefinition } from '../fixtures/workspace/packages/plugin-delta/src/index'

const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const fixtureRoot = fileURLToPath(new URL('../fixtures/workspace', import.meta.url))
const duplicateRoot = fileURLToPath(new URL('../fixtures/duplicate-id', import.meta.url))

const DIRECTIONS = 'Allowed: a capability (cap-* or plugin-*) or distribution -> a platform package\'s declared entries; a capability -> a dependency capability\'s root entry; never the reverse, never a relative path across package roots. Only a plugin-* package brings plugin types: its definition has no manifest and brings the plugin type named by its id, and a cap-* package brings none.'

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
    'packages/cap-epsilon/src/index.ts',
    'packages/cap-epsilon/src/ok.ts',
    'packages/plugin-delta/src/index.ts',
    'packages/plugin-delta/src/ok.ts',
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

  it('rejects a plugin package importing a platform internal path as it does a cap package', () => {
    expect(findings('packages/plugin-delta/src/bad-platform-subpath.ts')).toEqual([
      {
        rule: 'cm-packages/no-subpath-import',
        message: `Capability package @candy-mountain/plugin-delta may not import '@candy-mountain/platform-core/src/internal': @candy-mountain/platform-core declares no './src/internal' entry. ${DIRECTIONS}`,
      },
    ])
  })

  it('holds a plugin package to the capability directions toward cap packages and the platform', () => {
    expect(findings('packages/plugin-delta/src/bad-capability.ts')).toEqual([
      {
        rule: 'cm-packages/no-subpath-import',
        message: `Capability package @candy-mountain/plugin-delta may not import '@candy-mountain/cap-alpha/src/index': a capability package is reachable only through its root entry '@candy-mountain/cap-alpha'. ${DIRECTIONS}`,
      },
      {
        rule: 'cm-packages/no-undeclared-capability-import',
        message: `Capability package @candy-mountain/plugin-delta may not import '@candy-mountain/cap-beta': @candy-mountain/cap-beta is not in its package.json dependencies, so its definition cannot name 'beta' in dependsOn either. ${DIRECTIONS}`,
      },
      {
        rule: 'cm-packages/no-unlisted-dependency',
        message: `Capability package @candy-mountain/plugin-delta may not import '@candy-mountain/cap-beta': @candy-mountain/cap-beta is not in its package.json dependencies or devDependencies. ${DIRECTIONS}`,
      },
      {
        rule: 'cm-packages/no-relative-cross-package',
        message: `Capability package @candy-mountain/plugin-delta may not import '../../platform-core/src/daemon/index': the path leaves the package. Import @candy-mountain/platform-core through its root entry. ${DIRECTIONS}`,
      },
    ])
  })

  it('holds a cap package to the capability directions toward a plugin package', () => {
    expect(findings('packages/cap-alpha/src/bad-undeclared-plugin.ts')).toEqual([
      {
        rule: 'cm-packages/no-undeclared-capability-import',
        message: `Capability package @candy-mountain/cap-alpha may not import '@candy-mountain/plugin-delta': @candy-mountain/plugin-delta is not in its package.json dependencies, so its definition cannot name 'delta' in dependsOn either. ${DIRECTIONS}`,
      },
      {
        rule: 'cm-packages/no-unlisted-dependency',
        message: `Capability package @candy-mountain/cap-alpha may not import '@candy-mountain/plugin-delta': @candy-mountain/plugin-delta is not in its package.json dependencies or devDependencies. ${DIRECTIONS}`,
      },
    ])
    expect(findings('packages/cap-epsilon/src/bad-plugin.ts')).toEqual([
      {
        rule: 'cm-packages/no-subpath-import',
        message: `Capability package @candy-mountain/cap-epsilon may not import '@candy-mountain/plugin-delta/src/index': a capability package is reachable only through its root entry '@candy-mountain/plugin-delta'. ${DIRECTIONS}`,
      },
      {
        rule: 'cm-packages/no-relative-cross-package',
        message: `Capability package @candy-mountain/cap-epsilon may not import '../../plugin-delta/src/ok': the path leaves the package. Import @candy-mountain/plugin-delta through its root entry. ${DIRECTIONS}`,
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

  it('rejects a platform package importing a plugin package', () => {
    expect(findings('packages/platform-core/src/uses-plugin.ts')).toEqual([
      {
        rule: 'cm-packages/no-capability-import-from-platform',
        message: `Platform package @candy-mountain/platform-core may not import '@candy-mountain/plugin-delta': the platform never depends on a capability (@candy-mountain/plugin-delta). ${DIRECTIONS}`,
      },
      {
        rule: 'cm-packages/no-unlisted-dependency',
        message: `Platform package @candy-mountain/platform-core may not import '@candy-mountain/plugin-delta': @candy-mountain/plugin-delta is not in its package.json dependencies or devDependencies. ${DIRECTIONS}`,
      },
    ])
  })

  it('holds a distribution to a plugin package\'s root entry', () => {
    expect(findings('apps/daemon/src/bad-plugin.ts')).toEqual([
      {
        rule: 'cm-packages/no-subpath-import',
        message: `Package @fixture/daemon may not import '@candy-mountain/plugin-delta/src/index': a capability package is reachable only through its root entry '@candy-mountain/plugin-delta'. ${DIRECTIONS}`,
      },
      {
        rule: 'cm-packages/no-unlisted-dependency',
        message: `Package @fixture/daemon may not import '@candy-mountain/plugin-delta/src/index': @candy-mountain/plugin-delta is not in its package.json dependencies or devDependencies. ${DIRECTIONS}`,
      },
    ])
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
      '@candy-mountain/cap-epsilon',
      '@candy-mountain/cap-gamma',
      '@candy-mountain/platform-core',
      '@candy-mountain/plugin-delta',
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
    expect(packages.get('@candy-mountain/plugin-delta')).toMatchObject({
      kind: 'capability',
      capabilityId: 'delta',
      entries: ['.'],
      dependencies: ['@candy-mountain/cap-alpha', '@candy-mountain/platform-core'],
    })
    expect(packages.get('@fixture/daemon')).toMatchObject({ kind: 'other', entries: ['.'], presets: [] })
    expect(kindOf('@candy-mountain/claude-acp')).toBe('other')
    expect(kindOf('@candy-mountain/plugin-claude-code')).toBe('capability')
    expect(capabilityId('@candy-mountain/cap-chat-claude-code')).toBe('chat-claude-code')
    expect(capabilityId('@candy-mountain/plugin-claude-code')).toBe('claude-code')
    expect(capabilityId('@candy-mountain/platform-plugin-x')).toBeUndefined()
  })

  it('refuses a cap package and a plugin package that share an id, naming both', () => {
    expect(() => workspacePackages(duplicateRoot)).toThrow(
      '@candy-mountain/cap-alpha and @candy-mountain/plugin-alpha both carry capability id \'alpha\'; a cap- and a plugin- package may not share an id.',
    )
  })

  it('finds the workspace root above a file', () => {
    expect(workspaceRoot(`${fixtureRoot}/packages/cap-alpha/src`)).toBe(fixtureRoot)
    expect(workspaceRoot(fileURLToPath(import.meta.url))).not.toBe(fixtureRoot)
  })
})

describe('capability dependency drift', () => {
  const packages = workspacePackages(fixtureRoot)
  const pkg = (name: string) => packages.get(`@candy-mountain/${name}`)!

  it('is empty when package.json dependencies and dependsOn agree, ignoring platform ids', () => {
    expect(capabilityDependencyDrift(pkg('cap-alpha'), alphaDefinition(), packages)).toEqual([])
    expect(capabilityDependencyDrift(pkg('cap-beta'), betaDefinition(), packages)).toEqual([])
  })

  it('names a dependency the definition omits and a dependsOn the package omits', () => {
    expect(capabilityDependencyDrift(pkg('cap-gamma'), gammaDefinition(), packages)).toEqual([
      '@candy-mountain/cap-gamma lists @candy-mountain/cap-alpha in its dependencies but its definition\'s dependsOn omits \'alpha\'',
      '@candy-mountain/cap-gamma\'s definition depends on \'beta\' but its package.json dependencies omit @candy-mountain/cap-beta',
    ])
  })

  it('is empty for a plugin package whose dependsOn matches, and for a cap package depending on a plugin package', () => {
    expect(capabilityDependencyDrift(pkg('plugin-delta'), deltaDefinition(), packages)).toEqual([])
    expect(capabilityDependencyDrift(pkg('cap-epsilon'), { id: 'epsilon', dependsOn: ['delta'] }, packages)).toEqual([])
  })

  it('names both packages when a cap package and a plugin package\'s dependsOn disagree with its package.json', () => {
    expect(capabilityDependencyDrift(pkg('cap-epsilon'), epsilonDefinition(), packages)).toEqual([
      '@candy-mountain/cap-epsilon lists @candy-mountain/plugin-delta in its dependencies but its definition\'s dependsOn omits \'delta\'',
    ])
    expect(capabilityDependencyDrift(pkg('cap-alpha'), { id: 'alpha', dependsOn: ['delta'] }, packages)).toEqual([
      '@candy-mountain/cap-alpha\'s definition depends on \'delta\' but its package.json dependencies omit @candy-mountain/plugin-delta',
    ])
    expect(capabilityDependencyDrift(pkg('plugin-delta'), { id: 'delta', dependsOn: ['beta'] }, packages)).toEqual([
      '@candy-mountain/plugin-delta lists @candy-mountain/cap-alpha in its dependencies but its definition\'s dependsOn omits \'alpha\'',
      '@candy-mountain/plugin-delta\'s definition depends on \'beta\' but its package.json dependencies omit @candy-mountain/cap-beta',
    ])
  })

  it('names a definition whose id is not the package\'s', () => {
    expect(capabilityDependencyDrift(pkg('cap-alpha'), betaDefinition(), packages)).toEqual([
      '@candy-mountain/cap-alpha exports the definition of \'beta\', not \'alpha\'',
      '@candy-mountain/cap-alpha\'s definition depends on \'alpha\' but its package.json dependencies omit @candy-mountain/cap-alpha',
    ])
    expect(capabilityDependencyDrift(pkg('plugin-delta'), { id: 'epsilon', dependsOn: ['alpha'] }, packages)).toEqual([
      '@candy-mountain/plugin-delta exports the definition of \'epsilon\', not \'delta\'',
    ])
  })
})

describe('capability kind', () => {
  const packages = workspacePackages(fixtureRoot)
  const pkg = (name: string) => packages.get(`@candy-mountain/${name}`)!

  it('is empty for a plugin package bringing its own plugin type without a manifest, and for cap packages with or without a manifest', () => {
    expect(capabilityKindProblems(pkg('plugin-delta'), deltaDefinition())).toEqual([])
    expect(capabilityKindProblems(pkg('cap-alpha'), alphaDefinition())).toEqual([])
    expect(capabilityKindProblems(pkg('cap-beta'), betaDefinition())).toEqual([])
  })

  it('names a plugin package whose definition has a manifest', () => {
    expect(capabilityKindProblems(pkg('plugin-delta'), { ...deltaDefinition(), manifest: { id: 'delta' } })).toEqual([
      '@candy-mountain/plugin-delta is a plugin- package, so its definition may not have a manifest',
    ])
  })

  it('names a plugin package whose definition brings no plugin types, or none with its id', () => {
    expect(capabilityKindProblems(pkg('plugin-delta'), { id: 'delta' })).toEqual([
      '@candy-mountain/plugin-delta is a plugin- package, so its definition must bring plugin type \'delta\'',
    ])
    expect(capabilityKindProblems(pkg('plugin-delta'), { id: 'delta', pluginTypes: [{ id: 'other' }] })).toEqual([
      '@candy-mountain/plugin-delta is a plugin- package, so its definition must bring plugin type \'delta\'',
    ])
  })

  it('names a cap package whose definition brings plugin types', () => {
    expect(capabilityKindProblems(pkg('cap-epsilon'), { ...epsilonDefinition(), pluginTypes: [{ id: 'delta' }, { id: 'zeta' }] })).toEqual([
      '@candy-mountain/cap-epsilon is a cap- package, so its definition may not bring plugin types, but it brings \'delta\', \'zeta\'; move them to a plugin- package',
    ])
  })
})
