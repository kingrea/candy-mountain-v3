import type { CreateWorkspaceRequest, ModuleDefinition, Workspace } from '@crab-shack/platform-sdk'
import { repositoryDefinition, setRepository } from '@candy-mountain/plugin-repository'
import { createWorkspace, type Db, type PlatformDatabase, type Product } from '@crab-shack/platform-daemon'
import { openTestDatabase, testKit, testProduct, type TestKit, type TestWorkspaceOptions } from '@crab-shack/platform-daemon/testing'
import { issuesDefinition, type IssuesOptions } from './definition'

/** A module holding issues, so grants and enablement behave as they do under a product. */
export const ISSUES_TEST_MODULE: ModuleDefinition = { id: 'issues', label: 'Issues', description: 'The project\'s issues.', icon: 'i-lucide-list-todo', capabilities: [{ capabilityId: 'issues', defaultRung: 'write' }] }

export const issuesTestProduct = (options?: IssuesOptions): Product => testProduct({ capabilities: [repositoryDefinition(), issuesDefinition(options)], modules: [ISSUES_TEST_MODULE] })

export const openIssuesDatabase = (): PlatformDatabase => openTestDatabase({ definitions: [repositoryDefinition(), issuesDefinition()] })

/** The test kit over `issuesTestProduct`. */
export const issuesKit = (options?: IssuesOptions): TestKit => testKit({ product: issuesTestProduct(options) })

/** A kit workspace whose repository is the checkout at `path`. */
export async function workspaceAt(kit: TestKit, path: string, options: TestWorkspaceOptions = {}): Promise<Workspace> {
  const workspace = kit.workspace(options)
  await setRepository(kit.db, workspace.id, { kind: 'local-path', path })
  return workspace
}

/** A workspace whose repository is the existing directory at `path`. */
export async function createWorkspaceWithRepository(db: Db, { path, ...input }: CreateWorkspaceRequest & { path: string }): Promise<Workspace> {
  const workspace = createWorkspace(db, input)
  await setRepository(db, workspace.id, { kind: 'local-path', path })
  return workspace
}
