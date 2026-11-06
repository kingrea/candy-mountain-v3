import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { capabilityDependencyDrift, workspacePackages, workspaceRoot } from '@candy-mountain/platform-config/package-boundaries'
import { describe, expect, it } from 'vitest'
import { capabilityDefinitions } from './definitions'

const root = workspaceRoot(fileURLToPath(import.meta.url))!
const packages = workspacePackages(root)
const capabilities = [...packages.values()].filter(pkg => pkg.kind === 'capability')
const definitions = new Map(capabilityDefinitions().map(definition => [definition.id, definition]))

/** The lint allows what package.json lists; the runtime starts what dependsOn names. They must be the same list. */
describe('capability packages', () => {
  it('live in packages/cap-<id> and expose one root entry', () => {
    const misplaced = capabilities.filter(pkg => basename(pkg.dir) !== `cap-${pkg.capabilityId}` || pkg.entries.join() !== '.')
    expect(misplaced.map(pkg => `${pkg.name} at ${pkg.dir} (entries ${pkg.entries.join(', ')})`)).toEqual([])
  })

  it('declare the same capability dependencies in package.json and in dependsOn', () => {
    const problems = capabilities.flatMap((pkg) => {
      const definition = definitions.get(pkg.capabilityId!)
      if (!definition) return [`the distribution lists no definition with id '${pkg.capabilityId}' for ${pkg.name}`]
      return capabilityDependencyDrift(pkg, definition, packages)
    })
    expect(problems).toEqual([])
  })
})
