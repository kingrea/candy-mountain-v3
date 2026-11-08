import type { ESLint, Linter } from 'eslint'

export interface WorkspacePackage {
  name: string
  dir: string
  kind: 'platform' | 'capability' | 'other'
  distribution: boolean
  capabilityId: string | undefined
  dependencies: string[]
  devDependencies: string[]
  entries: string[]
  presets: string[]
}

export function capabilityId(name: string): string | undefined
export function kindOf(name: string): WorkspacePackage['kind']
export function workspaceRoot(from: string): string | undefined
export function workspacePackages(root: string): Map<string, WorkspacePackage>
export function capabilityDependencyDrift(
  pkg: WorkspacePackage,
  definition: { id: string, dependsOn?: readonly string[] },
  packages: Map<string, WorkspacePackage>,
): string[]
export function capabilityKindProblems(
  pkg: WorkspacePackage,
  definition: { id: string, manifest?: unknown, pluginTypes?: readonly { id: string }[] },
): string[]
export function packageBoundaries(): Linter.Config

declare const plugin: ESLint.Plugin
export default plugin
