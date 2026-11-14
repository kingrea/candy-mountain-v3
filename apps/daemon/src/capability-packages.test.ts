import { fileURLToPath } from 'node:url'
import { capabilityPackageProblems, workspacePackages, workspaceRoot } from '@crab-shack/platform-config/package-boundaries'
import { describe, expect, it } from 'vitest'
import { capabilityDefinitions, DEFINITIONS } from './definitions'

const root = workspaceRoot(fileURLToPath(import.meta.url))!
const packages = workspacePackages(root)
const capabilities = [...packages.values()].filter(pkg => pkg.kind === 'capability')
// The capability packages installed from the registry, and any the workspace holds.
const problems = capabilityPackageProblems(packages, { daemon: packages.get('@candy-mountain/daemon')!, listed: Object.keys(DEFINITIONS), definitions: capabilityDefinitions() })

/** The lint allows what package.json lists; the runtime starts what dependsOn names. They must be the same list. */
describe('capability packages', () => {
  it('live, in the workspace, in packages/cap-<id> or packages/plugin-<id> after their name, and expose one root entry', () => {
    expect(problems.placement).toEqual([])
  })

  it('are each listed by the daemon in DEFINITIONS and in its dependencies, never in one without the other', () => {
    expect(capabilities.length).toBeGreaterThan(0)
    expect(problems.registration).toEqual([])
  })

  it('declare the same capability dependencies in package.json and in dependsOn', () => {
    expect(problems.dependencies).toEqual([])
  })

  it('state the SDK major they target as the same major in a package.json peer range and in the definition, which names the package', () => {
    expect(problems.sdk).toEqual([])
  })

  it('bring plugin types only from plugin- packages, each without a manifest and bringing the type named by its id', () => {
    expect(problems.kind).toEqual([])
  })
})
