import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { capabilityDependencyDrift, capabilityKindProblems, workspacePackages, workspaceRoot } from '@candy-mountain/platform-config/package-boundaries'
import { describe, expect, it } from 'vitest'
import { capabilityDefinitions, DEFINITIONS } from './definitions'
import { DEVELOPMENT_DEFINITIONS, developmentDefinitions } from './development'

const root = workspaceRoot(fileURLToPath(import.meta.url))!
const packages = workspacePackages(root)
const daemon = packages.get('@candy-mountain/daemon')!
const capabilities = [...packages.values()].filter(pkg => pkg.kind === 'capability')
const definitions = new Map([...capabilityDefinitions(), ...developmentDefinitions()].map(definition => [definition.id, definition]))

/** The lint allows what package.json lists; the runtime starts what dependsOn names. They must be the same list. */
describe('capability packages', () => {
  it('live in packages/cap-<id> or packages/plugin-<id> after their name and expose one root entry', () => {
    const misplaced = capabilities.filter(pkg => basename(pkg.dir) !== pkg.name.replace('@candy-mountain/', '') || pkg.entries.join() !== '.')
    expect(misplaced.map(pkg => `${pkg.name} at ${pkg.dir} (entries ${pkg.entries.join(', ')})`)).toEqual([])
  })

  it('are listed by the daemon where they run: dependencies for the build, devDependencies for a development run, never both or neither', () => {
    const shipped = new Set(Object.keys(DEFINITIONS))
    const development = new Set(Object.keys(DEVELOPMENT_DEFINITIONS))
    expect([...development].filter(id => shipped.has(id))).toEqual([])
    const problems = capabilities.flatMap((pkg) => {
      const id = pkg.capabilityId!
      const listed = shipped.has(id) ? 'dependencies' : development.has(id) ? 'devDependencies' : undefined
      const depended = daemon.dependencies.includes(pkg.name) ? 'dependencies' : daemon.devDependencies.includes(pkg.name) ? 'devDependencies' : undefined
      if (listed === depended && listed) return []
      return [`${pkg.name}: ${listed ? `in ${listed === 'dependencies' ? 'DEFINITIONS' : 'DEVELOPMENT_DEFINITIONS'}` : 'in neither definition list'}, ${depended ? `in ${depended}` : 'in neither dependency section'} of apps/daemon/package.json`]
    })
    expect(problems).toEqual([])
  })

  it('declare the same capability dependencies in package.json and in dependsOn', () => {
    const problems = capabilities.flatMap((pkg) => {
      const definition = definitions.get(pkg.capabilityId!)
      if (!definition) return [`the distribution lists no definition with id '${pkg.capabilityId}' for ${pkg.name}`]
      return capabilityDependencyDrift(pkg, definition, packages)
    })
    expect(problems).toEqual([])
  })

  it('bring plugin types only from plugin- packages, each without a manifest and bringing the type named by its id', () => {
    const problems = capabilities.flatMap((pkg) => {
      const definition = definitions.get(pkg.capabilityId!)
      return definition ? capabilityKindProblems(pkg, definition) : []
    })
    expect(problems).toEqual([])
  })
})
